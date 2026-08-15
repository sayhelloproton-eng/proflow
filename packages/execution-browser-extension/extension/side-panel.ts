export {};

type ChromePanel = {
	runtime: { sendMessage(message: unknown): Promise<unknown> };
};
declare const chrome: ChromePanel;

type TaskSummary = {
	taskId: string;
	title: string;
	status: string;
	version: number;
	canStart?: boolean;
	blockedReason?: string | null;
};
type TaskView = TaskSummary & {
	roleBindings: Array<{
		agentPackageRef: string;
		roleRef: string;
		workerRef: string | null;
		conversationLocator: string | null;
	}>;
	nodes: Array<{
		nodeId: string;
		title: string;
		status: string;
		runNo: number;
		version: number;
	}>;
};

function element<T extends HTMLElement>(selector: string): T {
	const value = document.querySelector<T>(selector);
	if (!value) throw new Error(`SIDE_PANEL_TARGET_MISSING:${selector}`);
	return value;
}

const connection = element<HTMLElement>("#connection");
const browserStatus = element<HTMLElement>("#browser-status");
const tasksTarget = element<HTMLElement>("#tasks");
const selectedTarget = element<HTMLElement>("#selected-task");
const nodesTarget = element<HTMLElement>("#nodes");
const errorTarget = element<HTMLElement>("#error");
const resultTarget = element<HTMLElement>("#result");
const startButton = element<HTMLButtonElement>("#start-task");
const ensureWorkersButton = element<HTMLButtonElement>("#ensure-workers");
const newTaskForm = element<HTMLFormElement>("#new-task-form");

let selected: TaskView | null = null;

function requestId(prefix: string): string {
	return `${prefix}:${crypto.randomUUID()}`;
}

function record(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error("TASK_APPLICATION_RESPONSE_INVALID");
	return value as Record<string, unknown>;
}

async function taskApplication(
	operation: string,
	input: Record<string, unknown>,
): Promise<unknown> {
	const raw = await chrome.runtime.sendMessage({
		type: "PROFLOW_TASK_APPLICATION",
		operation,
		input,
	});
	const response = record(raw);
	if (response.ok !== true)
		throw new Error(
			typeof response.error === "string"
				? response.error
				: "TASK_APPLICATION_FAILED",
		);
	return response.value;
}

function setBusy(button: HTMLButtonElement, busy: boolean) {
	button.disabled = busy;
}

async function loadTask(taskId: string) {
	selected = (await taskApplication("task.get", { taskId })) as TaskView;
	selectedTarget.textContent = `${selected.taskId} · ${selected.status} · v${selected.version}`;
	startButton.disabled = selected.status !== "READY";
	ensureWorkersButton.disabled =
		selected.status === "SUCCEEDED" || selected.status === "TERMINATED";
	nodesTarget.replaceChildren();
	for (const node of selected.nodes) {
		const row = document.createElement("div");
		row.className = "task";
		const label = document.createElement("span");
		label.textContent = `${node.title} · ${node.status} · run ${node.runNo}`;
		row.append(label);
		if (["SUCCEEDED", "FAILED", "WAITING"].includes(node.status)) {
			const reopen = document.createElement("button");
			reopen.type = "button";
			reopen.textContent = "Reopen";
			reopen.addEventListener("click", () => {
				void run(async () => {
					if (!selected) return;
					await taskApplication("node.reopen", {
						taskId: selected.taskId,
						nodeId: node.nodeId,
						reason: "Human reopen from Extension Side Panel",
						expectedTaskVersion: selected.version,
						idempotencyKey: requestId("extension-reopen"),
					});
					await loadTask(selected.taskId);
					await refreshTasks();
				});
			});
			row.append(reopen);
		}
		nodesTarget.append(row);
	}
}

async function refreshTasks() {
	const value = record(await taskApplication("task.list", {}));
	const tasks = Array.isArray(value.tasks)
		? (value.tasks as TaskSummary[])
		: [];
	tasksTarget.replaceChildren();
	for (const task of tasks) {
		const row = document.createElement("div");
		row.className = "task";
		const open = document.createElement("button");
		open.type = "button";
		open.textContent = `${task.title} · ${task.status}`;
		open.addEventListener("click", () => void run(() => loadTask(task.taskId)));
		row.append(open);
		if (task.blockedReason) {
			const detail = document.createElement("div");
			detail.className = "meta";
			detail.textContent = task.blockedReason;
			row.append(detail);
		}
		tasksTarget.append(row);
	}
}

async function refreshBrowserStatus() {
	const snapshot = record(
		await chrome.runtime.sendMessage({ type: "PROFLOW_SIDE_PANEL_SNAPSHOT" }),
	);
	connection.textContent =
		snapshot.taskApplicationConfigured === true
			? "Task application connected"
			: "Task application not configured — open Extension Options";
	browserStatus.textContent = JSON.stringify(snapshot, null, 2);
	if (snapshot.taskApplicationConfigured === true) await refreshTasks();
}

async function run(action: () => Promise<void>) {
	errorTarget.textContent = "";
	try {
		await action();
	} catch (error) {
		errorTarget.textContent =
			error instanceof Error ? error.message : "Operation failed";
	}
}

newTaskForm.addEventListener("submit", (event) => {
	event.preventDefault();
	void run(async () => {
		const title = element<HTMLInputElement>("#task-title").value.trim();
		const objective =
			element<HTMLTextAreaElement>("#task-objective").value.trim();
		const requirement = element<HTMLTextAreaElement>("#task-requirement").value;
		const nodes = JSON.parse(
			element<HTMLTextAreaElement>("#task-plan").value,
		) as unknown;
		if (!Array.isArray(nodes) || nodes.length === 0)
			throw new Error("Task plan must be a non-empty JSON array");
		const value = await taskApplication("task.create", {
			title,
			objective,
			plan: { nodes },
			initialDocuments:
				requirement.length > 0
					? [{ documentType: "REQUIREMENT", content: requirement }]
					: [],
			idempotencyKey: requestId("extension-new-task"),
		});
		const created = record(value);
		resultTarget.textContent = `Created ${String(created.taskId ?? "Task")}.`;
		if (typeof created.taskId === "string") await loadTask(created.taskId);
		await refreshTasks();
	});
});

element<HTMLButtonElement>("#refresh-tasks").addEventListener(
	"click",
	() => void run(refreshTasks),
);

startButton.addEventListener("click", () => {
	void run(async () => {
		if (!selected) return;
		setBusy(startButton, true);
		try {
			await taskApplication("task.start", {
				taskId: selected.taskId,
				expectedTaskVersion: selected.version,
				idempotencyKey: requestId("extension-start-task"),
			});
			await loadTask(selected.taskId);
			await refreshTasks();
		} finally {
			startButton.disabled = selected?.status !== "READY";
		}
	});
});

ensureWorkersButton.addEventListener("click", () => {
	void run(async () => {
		if (!selected) return;
		setBusy(ensureWorkersButton, true);
		try {
			await taskApplication("task.ensureWorkers", { taskId: selected.taskId });
			await loadTask(selected.taskId);
			await refreshTasks();
		} finally {
			ensureWorkersButton.disabled =
				selected?.status === "SUCCEEDED" || selected?.status === "TERMINATED";
		}
	});
});

void run(refreshBrowserStatus);
setInterval(() => {
	void run(refreshBrowserStatus);
}, 5_000);

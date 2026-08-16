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
type ApprovalView = {
	approvalRef: string;
	executionRef: string;
	capability: string;
	callerRef: string;
	taskId?: string;
	status:
		| "PENDING"
		| "APPROVED"
		| "DENIED"
		| "REVOKED"
		| "CONSUMED"
		| "EXPIRED";
	version: number;
	expiresAt: string;
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
const approvalsTarget = element<HTMLElement>("#approvals");
const systemAssessmentTarget = element<HTMLElement>("#system-assessment");

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

async function approvalApplication(
	operation: string,
	input: Record<string, unknown>,
): Promise<unknown> {
	const raw = await chrome.runtime.sendMessage({
		type: "PROFLOW_APPROVAL_APPLICATION",
		operation,
		input,
	});
	const response = record(raw);
	if (response.ok !== true)
		throw new Error(
			typeof response.error === "string"
				? response.error
				: "APPROVAL_APPLICATION_FAILED",
		);
	return response.value;
}

async function refreshApprovals() {
	const value = record(
		await approvalApplication("approval.list", { status: "PENDING" }),
	);
	const approvals = Array.isArray(value.approvals)
		? (value.approvals as ApprovalView[])
		: [];
	approvalsTarget.replaceChildren();
	for (const approval of approvals) {
		const row = document.createElement("div");
		row.className = "task";
		const label = document.createElement("span");
		label.textContent = `${approval.capability} · ${approval.executionRef} · expires ${approval.expiresAt}`;
		row.append(label);
		const allow = document.createElement("button");
		allow.type = "button";
		allow.textContent = "Allow";
		allow.addEventListener(
			"click",
			() =>
				void run(async () => {
					await approvalApplication("approval.allow", {
						approvalRef: approval.approvalRef,
						expectedVersion: approval.version,
					});
					await refreshApprovals();
				}),
		);
		const deny = document.createElement("button");
		deny.type = "button";
		deny.textContent = "Deny";
		deny.addEventListener(
			"click",
			() =>
				void run(async () => {
					await approvalApplication("approval.deny", {
						approvalRef: approval.approvalRef,
						expectedVersion: approval.version,
						reason: "Denied from Extension Side Panel",
					});
					await refreshApprovals();
				}),
		);
		row.append(allow, deny);
		approvalsTarget.append(row);
	}
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
		snapshot.taskApplicationConfigured === true &&
		snapshot.approvalApplicationConfigured === true
			? "Task + Approval applications connected"
			: "Local application credential missing — open Extension Options";
	browserStatus.textContent = JSON.stringify(snapshot, null, 2);
	const observer =
		typeof snapshot.systemObserver === "object" &&
		snapshot.systemObserver !== null &&
		!Array.isArray(snapshot.systemObserver)
			? (snapshot.systemObserver as Record<string, unknown>)
			: null;
	if (observer === null) {
		systemAssessmentTarget.textContent = "No assessment yet.";
	} else {
		const unresolved = Array.isArray(observer.unresolved)
			? observer.unresolved.filter((item): item is string => typeof item === "string")
			: [];
		const carry = Array.isArray(observer.carryForward)
			? observer.carryForward
			: [];
		systemAssessmentTarget.textContent = [
			`assessmentRef: ${String(observer.assessmentRef ?? "?")}`,
			`needsHumanAttention: ${observer.needsHumanAttention === true}`,
			`unresolved: ${unresolved.join(" | ")}`,
			`carryForward: ${carry.length}`,
		].join("\n");
	}
	if (snapshot.taskApplicationConfigured === true) await refreshTasks();
	if (snapshot.approvalApplicationConfigured === true) await refreshApprovals();
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
			const nodes = JSON.parse(
				element<HTMLTextAreaElement>("#task-plan").value,
			) as unknown;
			if (!Array.isArray(nodes) || nodes.length === 0)
				throw new Error("Task plan must be a non-empty JSON array");
			const value = await taskApplication("task.create", {
				title,
				objective,
				plan: { nodes },
				initialDocuments: [],
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

element<HTMLButtonElement>("#refresh-approvals").addEventListener(
	"click",
	() => void run(refreshApprovals),
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

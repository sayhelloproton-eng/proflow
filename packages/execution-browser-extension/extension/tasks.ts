import type { CarrierAttentionView } from "../src/carrier-attention-view.js";

// The loopback Tasks surface publishes this entry as one authenticated
// `/tasks/app.js` module. A runtime relative import would escape `/tasks`, so keep
// the bounded parser local while sharing only the erased TypeScript type above.
function nullableString(value: unknown): value is string | null {
	return value === null || typeof value === "string";
}

function parseCarrierAttentionView(
	value: unknown,
): CarrierAttentionView | null {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return null;
	const attentionRef = Reflect.get(value, "attentionRef");
	const occurrenceRef = Reflect.get(value, "occurrenceRef");
	const taskId = Reflect.get(value, "taskId");
	const roleRef = Reflect.get(value, "roleRef");
	const workerRef = Reflect.get(value, "workerRef");
	const targetHost = Reflect.get(value, "targetHost");
	const operationId = Reflect.get(value, "operationId");
	const reason = Reflect.get(value, "reason");
	const actions = Reflect.get(value, "actions");
	const observedAt = Reflect.get(value, "observedAt");
	if (
		typeof attentionRef !== "string" ||
		attentionRef.length === 0 ||
		typeof occurrenceRef !== "string" ||
		occurrenceRef.length === 0 ||
		!nullableString(taskId) ||
		!nullableString(roleRef) ||
		!nullableString(workerRef) ||
		!nullableString(targetHost) ||
		typeof operationId !== "string" ||
		operationId.length === 0 ||
		typeof reason !== "string" ||
		reason.length === 0 ||
		!Array.isArray(actions) ||
		actions.some((action) => action !== "allowOnce" && action !== "deny") ||
		typeof observedAt !== "string" ||
		observedAt.length === 0
	)
		return null;
	return {
		attentionRef,
		occurrenceRef,
		taskId,
		roleRef,
		workerRef,
		targetHost,
		operationId,
		reason,
		actions: [...actions],
		observedAt,
	};
}

function parseCarrierAttentionViews(value: unknown): CarrierAttentionView[] {
	if (!Array.isArray(value)) return [];
	return value
		.slice(0, 128)
		.map(parseCarrierAttentionView)
		.filter((item): item is CarrierAttentionView => item !== null);
}

type ChromePanel = {
	runtime: { sendMessage(message: unknown): Promise<unknown> };
};
declare const chrome: ChromePanel;

const extensionRuntime = typeof chrome === "undefined" ? null : chrome.runtime;

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
	pendingMessages: Array<{
		messageId: string;
		nodeId: string | null;
		messageType: string;
		reasonCode: string;
		message: string;
	}>;
};

function element<T extends HTMLElement>(selector: string): T {
	const value = document.querySelector<T>(selector);
	if (!value) throw new Error(`TASK_PAGE_TARGET_MISSING:${selector}`);
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
const resumeButton = element<HTMLButtonElement>("#resume-task");
const pendingMessagesTarget = element<HTMLElement>("#pending-messages");
const newTaskForm = element<HTMLFormElement>("#new-task-form");
const approvalsTarget = element<HTMLElement>("#approvals");
const carrierAttentionsTarget = element<HTMLElement>("#carrier-attentions");
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

async function webApplication(
	path: "/tasks/api/task" | "/tasks/api/approval",
	operation: string,
	input: Record<string, unknown>,
): Promise<unknown> {
	const response = await fetch(path, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ operation, input }),
	});
	const body = record(await response.json());
	if (!response.ok || body.ok !== true)
		throw new Error(
			typeof body.error === "string" ? body.error : "TASK_WEB_REQUEST_FAILED",
		);
	return body.value;
}

async function taskApplication(
	operation: string,
	input: Record<string, unknown>,
): Promise<unknown> {
	if (!extensionRuntime)
		return webApplication("/tasks/api/task", operation, input);
	const raw = await extensionRuntime.sendMessage({
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
	if (!extensionRuntime)
		return webApplication("/tasks/api/approval", operation, input);
	const raw = await extensionRuntime.sendMessage({
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

async function carrierAttentionAction(
	attentionRef: string,
	action: "allowOnce" | "deny",
): Promise<void> {
	if (!extensionRuntime) {
		const response = await fetch("/tasks/api/carrier-attention", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ attentionRef, action }),
		});
		const body = record(await response.json());
		if (!response.ok || body.ok !== true)
			throw new Error(
				typeof body.error === "string"
					? body.error
					: "CARRIER_ATTENTION_ACTION_FAILED",
			);
		return;
	}
	const raw = await extensionRuntime.sendMessage({
		type: "PROFLOW_CARRIER_ATTENTION_ACTION",
		input: { attentionRef, action },
	});
	const response = record(raw);
	if (response.ok !== true)
		throw new Error(
			typeof response.error === "string"
				? response.error
				: "CARRIER_ATTENTION_ACTION_FAILED",
		);
}

function renderCarrierAttentions(snapshot: Record<string, unknown>): void {
	const attentions = parseCarrierAttentionViews(snapshot.carrierAttentions);
	carrierAttentionsTarget.replaceChildren();
	if (attentions.length === 0) {
		carrierAttentionsTarget.textContent = "No carrier attention.";
		return;
	}
	for (const attention of attentions) {
		const row = document.createElement("div");
		row.className = "task";
		const label = document.createElement("div");
		label.textContent = `${attention.operationId} · ${attention.targetHost ?? "unknown target"}`;
		const detail = document.createElement("div");
		detail.className = "meta";
		detail.textContent = [
			attention.reason,
			attention.taskId ? `task ${attention.taskId}` : "task unknown",
			attention.roleRef ? `role ${attention.roleRef}` : "role unknown",
		].join(" · ");
		row.append(label, detail);
		if (attention.actions.includes("allowOnce")) {
			const allow = document.createElement("button");
			allow.type = "button";
			allow.textContent = "Allow once";
			allow.addEventListener(
				"click",
				() =>
					void run(async () => {
						await carrierAttentionAction(attention.attentionRef, "allowOnce");
						await refreshBrowserStatus();
					}),
			);
			row.append(allow);
		}
		if (attention.actions.includes("deny")) {
			const deny = document.createElement("button");
			deny.type = "button";
			deny.textContent = "Deny";
			deny.addEventListener(
				"click",
				() =>
					void run(async () => {
						await carrierAttentionAction(attention.attentionRef, "deny");
						await refreshBrowserStatus();
					}),
			);
			row.append(deny);
		}
		carrierAttentionsTarget.append(row);
	}
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
						reason: "Denied from Extension Task Page",
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
	resumeButton.hidden = !["WAITING", "PAUSED"].includes(selected.status);
	resumeButton.disabled =
		selected.status === "WAITING" && selected.pendingMessages.length > 0;
	pendingMessagesTarget.replaceChildren();
	for (const message of selected.pendingMessages) {
		const row = document.createElement("div");
		row.className = "task";
		const label = document.createElement("div");
		label.textContent = `${message.messageType} · ${message.reasonCode}`;
		const detail = document.createElement("div");
		detail.className = "meta";
		detail.textContent = message.message;
		const acknowledge = document.createElement("button");
		acknowledge.type = "button";
		acknowledge.textContent = "Resolve blocker";
		acknowledge.addEventListener("click", () => {
			void run(async () => {
				if (!selected) return;
				await taskApplication("message.acknowledge", {
					messageId: message.messageId,
					resolution: "Resolved from Extension Task Page",
					idempotencyKey: requestId("extension-acknowledge-message"),
				});
				await loadTask(selected.taskId);
			});
		});
		row.append(label, detail, acknowledge);
		pendingMessagesTarget.append(row);
	}
	nodesTarget.replaceChildren();
	for (const node of selected.nodes) {
		const row = document.createElement("div");
		row.className = "task";
		const label = document.createElement("span");
		label.textContent = `${node.title} · ${node.status} · run ${node.runNo}`;
		row.append(label);
		if (["SUCCEEDED", "FAILED"].includes(node.status)) {
			const reopen = document.createElement("button");
			reopen.type = "button";
			reopen.textContent = "Reopen";
			reopen.addEventListener("click", () => {
				void run(async () => {
					if (!selected) return;
					await taskApplication("node.reopen", {
						taskId: selected.taskId,
						nodeId: node.nodeId,
						reason: "Human reopen from Extension Task Page",
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

async function pageStatus(): Promise<Record<string, unknown>> {
	if (extensionRuntime)
		return record(
			await extensionRuntime.sendMessage({
				type: "PROFLOW_SIDE_PANEL_SNAPSHOT",
			}),
		);
	const response = await fetch("/tasks/api/status", { cache: "no-store" });
	const body = record(await response.json());
	if (!response.ok || body.ok !== true)
		throw new Error(
			typeof body.error === "string" ? body.error : "TASK_WEB_STATUS_FAILED",
		);
	return record(body.value);
}

async function refreshBrowserStatus() {
	const snapshot = await pageStatus();
	renderCarrierAttentions(snapshot);
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
			? observer.unresolved.filter(
					(item): item is string => typeof item === "string",
				)
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

resumeButton.addEventListener("click", () => {
	void run(async () => {
		if (!selected) return;
		setBusy(resumeButton, true);
		try {
			await taskApplication("task.resume", {
				taskId: selected.taskId,
				expectedTaskVersion: selected.version,
				idempotencyKey: requestId("extension-resume-task"),
			});
			await loadTask(selected.taskId);
			await refreshTasks();
		} finally {
			resumeButton.disabled =
				selected?.status === "WAITING" &&
				(selected.pendingMessages?.length ?? 0) > 0;
		}
	});
});

void run(refreshBrowserStatus);
setInterval(() => {
	void run(refreshBrowserStatus);
}, 5_000);

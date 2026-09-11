export type PermissionSemanticAction =
	| "allowAlways"
	| "allow"
	| "allowOnce"
	| "deny";

export type ActionPermissionCandidate = {
	text: string;
	buttonLabels: readonly string[];
};

export type ActionPermissionFacts = {
	kind: "ACTION_PERMISSION";
	targetHost: string | null;
	operationId: string;
	taskId: string | null;
	actions: PermissionSemanticAction[];
	fingerprint: string;
};

const actionLabels: ReadonlyArray<readonly [RegExp, PermissionSemanticAction]> =
	[
		[/^(始终允许|always allow)$/i, "allowAlways"],
		[/^(允许一次|allow once)$/i, "allowOnce"],
		[/^(允许|allow)$/i, "allow"],
		[/^(拒绝|deny)$/i, "deny"],
	];

export function permissionSemanticAction(
	label: string,
): PermissionSemanticAction | null {
	const normalized = label.trim();
	for (const [pattern, action] of actionLabels)
		if (pattern.test(normalized)) return action;
	return null;
}

function normalizedText(value: string): string {
	return value.replace(/\s+/g, " ").trim().slice(0, 4_096);
}

function hashFingerprint(value: string): string {
	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

function targetHost(text: string): string | null {
	const url = text.match(/https?:\/\/([a-z0-9.-]+)(?=[/:\s"'”]|$)/i)?.[1];
	if (url) return url.toLowerCase();
	const hosts = text.match(/[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+){2,}/gi) ?? [];
	return (
		hosts.find((value) => value.includes("devtunnels.ms"))?.toLowerCase() ??
		hosts[0]?.toLowerCase() ??
		null
	);
}

function operationId(text: string): string | null {
	return (
		text.match(
			/(?:工具调用|tool call)\s*[：:]\s*[^\s.]+(?:\.[^\s.]+)*\.([A-Za-z][A-Za-z0-9_]*)/i,
		)?.[1] ?? null
	);
}

function taskId(text: string): string | null {
	return text.match(/\btask-[A-Za-z0-9-]+\b/)?.[0] ?? null;
}

export function detectActionPermission(
	candidates: readonly ActionPermissionCandidate[],
): ActionPermissionFacts | null {
	for (const candidate of candidates) {
		const actions = candidate.buttonLabels
			.map(permissionSemanticAction)
			.filter((value): value is PermissionSemanticAction => value !== null);
		const hasAllowAction =
			actions.includes("allowAlways") ||
			actions.includes("allow") ||
			actions.includes("allowOnce");
		if (!actions.includes("deny") || !hasAllowAction) continue;
		const text = normalizedText(candidate.text);
		const operation = operationId(text);
		if (!operation) continue;
		return {
			kind: "ACTION_PERMISSION",
			targetHost: targetHost(text),
			operationId: operation,
			taskId: taskId(text),
			actions,
			fingerprint: `permission:v1:${hashFingerprint(`${text}|${actions.join(",")}`)}`,
		};
	}
	return null;
}

export function permissionActionAllowed(
	facts: ActionPermissionFacts,
	expectedFingerprint: string,
	action: string,
): action is PermissionSemanticAction {
	return (
		facts.fingerprint === expectedFingerprint &&
		facts.actions.includes(action as PermissionSemanticAction)
	);
}

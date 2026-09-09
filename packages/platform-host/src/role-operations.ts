export const rolePackageRefs = [
	"@tomflow/proflow-agent-product",
	"@tomflow/proflow-agent-controller-dev",
	"@tomflow/proflow-agent-test-ops",
] as const;

export type RolePackageRef = (typeof rolePackageRefs)[number];
export const directToolActionIds = [
	"repomix",
	"localDev",
	"codeGraph",
] as const;
export type DirectToolActionId = (typeof directToolActionIds)[number];

const directToolOperations: Record<
	RolePackageRef,
	Record<DirectToolActionId, ReadonlySet<string>>
> = {
	"@tomflow/proflow-agent-product": {
		repomix: new Set(["pack", "grep", "read"]),
		localDev: new Set(["read", "list", "search", "process"]),
		codeGraph: new Set(["explore"]),
	},
	"@tomflow/proflow-agent-controller-dev": {
		repomix: new Set(["pack", "grep", "read"]),
		localDev: new Set(["read", "list", "search", "mutate", "run", "process"]),
		codeGraph: new Set(["explore"]),
	},
	"@tomflow/proflow-agent-test-ops": {
		repomix: new Set(["pack", "grep", "read"]),
		localDev: new Set(["read", "list", "search", "run", "process"]),
		codeGraph: new Set(["explore"]),
	},
};

const productProcessReads = new Set(["list", "ports", "status", "read"]);

export function roleAllowsDirectToolOperation(
	role: RolePackageRef,
	tool: DirectToolActionId,
	operation: string,
	input: Record<string, unknown>,
): boolean {
	if (!directToolOperations[role][tool].has(operation)) return false;
	if (
		role === "@tomflow/proflow-agent-product" &&
		tool === "localDev" &&
		operation === "process"
	) {
		return (
			typeof input.action === "string" && productProcessReads.has(input.action)
		);
	}
	return true;
}

/** Canonical platform-host authorization inventory for shipped Custom GPT operations. */
export const roleOperations: Record<RolePackageRef, ReadonlySet<string>> = {
	"@tomflow/proflow-agent-product": new Set([
		"getTask",
		"putTaskDocument",
		"getTaskDocument",
		"askPeer",
		"replyPeer",
		...directToolActionIds,
	]),
	"@tomflow/proflow-agent-controller-dev": new Set([
		"getTask",
		"getNodeContext",
		"startNode",
		"completeNode",
		"waitNode",
		"failNode",
		"reopenNode",
		"getTaskDocument",
		"putTaskDocument",
		"askPeer",
		"replyPeer",
		...directToolActionIds,
	]),
	"@tomflow/proflow-agent-test-ops": new Set([
		"getTask",
		"getNodeContext",
		"startNode",
		"completeNode",
		"waitNode",
		"failNode",
		"getTaskDocument",
		"putTaskDocument",
		"askPeer",
		"replyPeer",
		...directToolActionIds,
	]),
};

export const rolePackageRefs = [
	"@tomflow/proflow-agent-product",
	"@tomflow/proflow-agent-controller-dev",
	"@tomflow/proflow-agent-test-ops",
] as const;

export type RolePackageRef = (typeof rolePackageRefs)[number];

/**
 * Canonical platform-host authorization inventory for shipped Custom GPT
 * operations. This module is internal (not a package export); Role packages
 * continue to own the shipped OpenAPI documents while the Host owns runtime
 * authorization. Batch 6 mechanically reconciles the two inventories.
 */
export const roleOperations: Record<RolePackageRef, ReadonlySet<string>> = {
	"@tomflow/proflow-agent-product": new Set([
		"getTask",
		"putTaskDocument",
		"getTaskDocument",
		"askPeer",
		"replyPeer",
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
		"executeCapability",
		"getExecution",
		"readExecutionOutput",
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
		"executeCapability",
		"getExecution",
		"readExecutionOutput",
	]),
};

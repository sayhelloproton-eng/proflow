import { createWorkspaceRoleSetupClient } from "@tomflow/proflow-agent-runtime/role-management-client";
import {
	type CustomGptPackageProvisioningMaterial,
	type CustomGptProvisioningResult,
	createWorkspaceCustomGptProvisioningHost,
} from "@tomflow/proflow-execution-browser-extension/custom-gpt-provisioning";

export type WorkspaceCustomGptRoleProvisioningInput = {
	workspaceRoot: string;
	packageRoot: string;
	stagingRoot: string;
	gatewayUrl: string;
	material: CustomGptPackageProvisioningMaterial;
	commandTimeoutMs?: number;
	onlineTimeoutMs?: number;
};

type ProvisioningHostPort = {
	provisionPackage(input: {
		packageRoot: string;
		stagingRoot: string;
		gatewayUrl: string;
		material: CustomGptPackageProvisioningMaterial;
	}): Promise<CustomGptProvisioningResult>;
	close(): Promise<void>;
};

type WorkspaceRoleRegistryPort = {
	registerRole(input: unknown): Promise<unknown>;
	inspectRole(input: {
		agentPackageRef: string;
		expectedPackageVersion: string;
	}): {
		status: string;
		role?: { roleRef: string; carrierUrl: string };
	};
};

export type WorkspaceCustomGptProvisioningPorts = {
	createProvisioningHost(input: {
		workspaceRoot: string;
		commandTimeoutMs?: number;
		onlineTimeoutMs?: number;
	}): Promise<ProvisioningHostPort>;
	createRoleRegistry(workspaceRoot: string): Promise<WorkspaceRoleRegistryPort>;
};

const productionPorts: WorkspaceCustomGptProvisioningPorts = {
	createProvisioningHost: (input) =>
		createWorkspaceCustomGptProvisioningHost(input),
	createRoleRegistry: createWorkspaceRoleSetupClient,
};

function assertLiveCreated(
	result: CustomGptProvisioningResult,
	material: CustomGptPackageProvisioningMaterial,
): void {
	if (
		result.status !== "LIVE_CREATED" ||
		result.packageName !== material.packageName ||
		result.version !== material.version ||
		!/^g-[A-Za-z0-9_-]+$/.test(result.gptId) ||
		result.carrierUrl !== `https://chatgpt.com/g/${result.gptId}`
	)
		throw new Error("LIVE_CREATED_RESULT_INVALID");
}

export async function provisionCustomGptRole(
	input: WorkspaceCustomGptRoleProvisioningInput,
	ports: WorkspaceCustomGptProvisioningPorts,
): Promise<CustomGptProvisioningResult> {
	const host = await ports.createProvisioningHost({
		workspaceRoot: input.workspaceRoot,
		...(input.commandTimeoutMs === undefined
			? {}
			: { commandTimeoutMs: input.commandTimeoutMs }),
		...(input.onlineTimeoutMs === undefined
			? {}
			: { onlineTimeoutMs: input.onlineTimeoutMs }),
	});
	let result: CustomGptProvisioningResult;
	try {
		result = await host.provisionPackage({
			packageRoot: input.packageRoot,
			stagingRoot: input.stagingRoot,
			gatewayUrl: input.gatewayUrl,
			material: input.material,
		});
		assertLiveCreated(result, input.material);
	} finally {
		await host.close();
	}

	const registry = await ports.createRoleRegistry(input.workspaceRoot);
	await registry.registerRole({
		agentPackageRef: result.packageName,
		registeredPackageVersion: result.version,
		roleRef: result.gptId,
		carrierUrl: result.carrierUrl,
	});
	const persisted = registry.inspectRole({
		agentPackageRef: result.packageName,
		expectedPackageVersion: result.version,
	});
	if (
		persisted.status !== "READY" ||
		persisted.role?.roleRef !== result.gptId ||
		persisted.role.carrierUrl !== result.carrierUrl
	)
		throw new Error("WORKSPACE_ROLE_PERSISTENCE_NOT_READY");
	return result;
}

export function provisionWorkspaceCustomGptRole(
	input: WorkspaceCustomGptRoleProvisioningInput,
): Promise<CustomGptProvisioningResult> {
	return provisionCustomGptRole(input, productionPorts);
}

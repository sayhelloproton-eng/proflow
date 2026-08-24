import {
	type CustomGptPackageProvisioningMaterial,
	type CustomGptProvisioningResult,
	createWorkspaceCustomGptProvisioningHost,
} from "./custom-gpt-provisioner.ts";

export type CreateCustomGptRoleInput = {
	workspaceRoot: string;
	packageRoot: string;
	stagingRoot: string;
	gatewayUrl: string;
	material: CustomGptPackageProvisioningMaterial;
	commandTimeoutMs?: number;
	onlineTimeoutMs?: number;
};

export type CustomGptRoleRecordInput = {
	agentPackageRef: string;
	registeredPackageVersion: string;
	roleRef: string;
	carrierUrl: string;
};

export type CustomGptRoleRegistryPort = {
	saveRole(input: CustomGptRoleRecordInput): Promise<unknown>;
	inspectRole(input: {
		agentPackageRef: string;
		expectedPackageVersion: string;
	}): {
		status: string;
		role?: { roleRef: string; carrierUrl: string };
	};
};
type CustomGptProvisioningHostPort = {
	provisionPackage(input: {
		packageRoot: string;
		stagingRoot: string;
		gatewayUrl: string;
		material: CustomGptPackageProvisioningMaterial;
	}): Promise<CustomGptProvisioningResult>;
	close(): Promise<void>;
};

export type CreateCustomGptRolePorts = {
	roleRegistry: CustomGptRoleRegistryPort;
	createProvisioningHost?: (input: {
		workspaceRoot: string;
		commandTimeoutMs?: number;
		onlineTimeoutMs?: number;
	}) => Promise<CustomGptProvisioningHostPort>;
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

export async function createCustomGptRole(
	input: CreateCustomGptRoleInput,
	ports: CreateCustomGptRolePorts,
): Promise<CustomGptProvisioningResult> {
	const createHost =
		ports.createProvisioningHost ?? createWorkspaceCustomGptProvisioningHost;
	const host = await createHost({
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

	await ports.roleRegistry.saveRole({
		agentPackageRef: result.packageName,
		registeredPackageVersion: result.version,
		roleRef: result.gptId,
		carrierUrl: result.carrierUrl,
	});
	const persisted = ports.roleRegistry.inspectRole({
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

import { resolve } from "node:path";

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
	prepareCredential(): Promise<{ credential: string }> | { credential: string };
	saveRole(
		input: CustomGptRoleRecordInput,
		preparedCredential: string,
	): Promise<{ credential: string; rollback(): Promise<void> }>;
	deleteRole(roleRef: string): Promise<void>;
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
		credential: string;
	}): Promise<CustomGptProvisioningResult>;
	close(): Promise<void>;
};

export type CreateCustomGptRolePorts = {
	roleRegistry: CustomGptRoleRegistryPort;
	verifyCarrier(input: {
		agentPackageRef: string;
		registeredPackageVersion: string;
		roleRef: string;
		carrierUrl: string;
		gatewayUrl: string;
		credential: string;
		materialObservation: unknown;
	}): Promise<void>;
	createProvisioningHost?: (input: {
		workspaceRoot: string;
		commandTimeoutMs?: number;
		onlineTimeoutMs?: number;
	}) => Promise<CustomGptProvisioningHostPort>;
};

const workspaceCreateTails = new Map<string, Promise<void>>();

function enqueueWorkspaceCreate<T>(
	workspaceRoot: string,
	operation: () => Promise<T>,
): Promise<T> {
	const key = resolve(workspaceRoot);
	const previous = workspaceCreateTails.get(key) ?? Promise.resolve();
	const current = previous.catch(() => undefined).then(operation);
	const settled = current.then(
		() => undefined,
		() => undefined,
	);
	workspaceCreateTails.set(key, settled);
	return current.finally(() => {
		if (workspaceCreateTails.get(key) === settled)
			workspaceCreateTails.delete(key);
	});
}

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
	return enqueueWorkspaceCreate(input.workspaceRoot, async () => {
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
		let result: CustomGptProvisioningResult | undefined;
		let credential = "";
		try {
			const prepared = await ports.roleRegistry.prepareCredential();
			if (
				typeof prepared.credential !== "string" ||
				prepared.credential.length < 32
			)
				throw new Error("WORKSPACE_ROLE_CREDENTIAL_INVALID");
			credential = prepared.credential;
			result = await host.provisionPackage({
				packageRoot: input.packageRoot,
				stagingRoot: input.stagingRoot,
				gatewayUrl: input.gatewayUrl,
				material: input.material,
				credential,
			});
			assertLiveCreated(result, input.material);

			const saved = await ports.roleRegistry.saveRole(
				{
					agentPackageRef: result.packageName,
					registeredPackageVersion: result.version,
					roleRef: result.gptId,
					carrierUrl: result.carrierUrl,
				},
				credential,
			);
			if (typeof saved.credential !== "string" || saved.credential.length < 32)
				throw new Error("WORKSPACE_ROLE_CREDENTIAL_INVALID");
			if (saved.credential !== credential)
				throw new Error("WORKSPACE_ROLE_CREDENTIAL_MISMATCH");
			credential = saved.credential;

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

			await ports.verifyCarrier({
				agentPackageRef: result.packageName,
				registeredPackageVersion: result.version,
				roleRef: result.gptId,
				carrierUrl: result.carrierUrl,
				gatewayUrl: input.gatewayUrl,
				credential,
				materialObservation: result.materialObservation,
			});
			return result;
		} finally {
			// Remote GPT creation is irreversible from this host. Do not roll the durable
			// Role back after post-create validation failure; the caller can safely revalidate
			// that same Role on the next setup instead of creating a duplicate GPT.
			credential = "";
			await host.close();
		}
	});
}

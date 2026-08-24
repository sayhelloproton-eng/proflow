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
	saveRole(input: CustomGptRoleRecordInput): Promise<{ credential: string }>;
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
	}): Promise<CustomGptProvisioningResult>;
	finalizeRoleAuth(input: {
		carrierUrl: string;
		credential: string;
	}): Promise<{ status: "AUTH_UPDATED"; gptId: string }>;
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
		let persistedRoleRef: string | undefined;
		let credential = "";
		try {
			result = await host.provisionPackage({
				packageRoot: input.packageRoot,
				stagingRoot: input.stagingRoot,
				gatewayUrl: input.gatewayUrl,
				material: input.material,
			});
			assertLiveCreated(result, input.material);

			const saved = await ports.roleRegistry.saveRole({
				agentPackageRef: result.packageName,
				registeredPackageVersion: result.version,
				roleRef: result.gptId,
				carrierUrl: result.carrierUrl,
			});
			if (typeof saved.credential !== "string" || saved.credential.length < 32)
				throw new Error("WORKSPACE_ROLE_CREDENTIAL_INVALID");
			credential = saved.credential;
			persistedRoleRef = result.gptId;

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

			const auth = await host.finalizeRoleAuth({
				carrierUrl: result.carrierUrl,
				credential,
			});
			if (auth.status !== "AUTH_UPDATED" || auth.gptId !== result.gptId)
				throw new Error("CUSTOM_GPT_AUTH_NOT_READY");

			await ports.verifyCarrier({
				agentPackageRef: result.packageName,
				registeredPackageVersion: result.version,
				roleRef: result.gptId,
				carrierUrl: result.carrierUrl,
				gatewayUrl: input.gatewayUrl,
				credential,
			});
			return result;
		} catch (error) {
			if (persistedRoleRef !== undefined) {
				try {
					await ports.roleRegistry.deleteRole(persistedRoleRef);
				} catch {
					throw new Error("WORKSPACE_ROLE_ROLLBACK_FAILED");
				}
			}
			throw error;
		} finally {
			credential = "";
			await host.close();
		}
	});
}

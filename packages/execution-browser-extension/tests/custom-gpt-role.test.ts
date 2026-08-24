import assert from "node:assert/strict";
import { test } from "node:test";

import {
	type CustomGptRoleRegistryPort,
	createCustomGptRole,
} from "../src/custom-gpt-role.ts";

const credential = "role-credential-".padEnd(40, "x");
const material = {
	packageName: "@tomflow/example-agent",
	version: "1.2.3",
	displayName: "Example Agent",
	description: "Example role",
	instructions: "Do the work",
	conversationStarters: ["Start"],
	recommendedModel: "gpt-5-6",
	capabilities: {
		webSearch: true,
		imageGeneration: false,
		codeInterpreter: false,
	},
	knowledgeBundle: "knowledge/custom-gpt-knowledge.zip",
	actionSchema: "actions/custom-gpt.openapi.yaml",
};

function input(packageName = material.packageName) {
	return {
		workspaceRoot: "/workspace",
		packageRoot: "/package",
		stagingRoot: "/workspace/.proflow/staging/example-agent",
		gatewayUrl: "https://gateway.example.test",
		material: { ...material, packageName },
	};
}

function liveResult(packageName = material.packageName) {
	const suffix = packageName.split("/").at(-1) ?? "agent";
	const gptId = `g-${suffix}`;
	return {
		status: "LIVE_CREATED" as const,
		packageName,
		version: material.version,
		gptId,
		carrierUrl: `https://chatgpt.com/g/${gptId}`,
		knowledgeBundleSha256: `sha256:${"a".repeat(64)}`,
		knowledgeFiles: [],
	};
}

function registry(
	options: {
		onSave?: () => void;
		onInspect?: () => void;
		onDelete?: (roleRef: string) => void;
	} = {},
) {
	const saved = new Map<string, { roleRef: string; carrierUrl: string }>();
	const port: CustomGptRoleRegistryPort = {
		async saveRole(value) {
			options.onSave?.();
			saved.set(value.agentPackageRef, {
				roleRef: value.roleRef,
				carrierUrl: value.carrierUrl,
			});
			return { credential };
		},
		async deleteRole(roleRef) {
			options.onDelete?.(roleRef);
			for (const [packageRef, role] of saved)
				if (role.roleRef === roleRef) saved.delete(packageRef);
		},
		inspectRole(value) {
			options.onInspect?.();
			const role = saved.get(value.agentPackageRef);
			return role ? { status: "READY", role } : { status: "MISSING" };
		},
	};
	return { port, saved };
}

test("createCustomGptRole completes persist → auth → carrier verification before success", async () => {
	const order: string[] = [];
	const state = registry({
		onSave: () => order.push("save"),
		onInspect: () => order.push("inspect"),
	});
	const result = await createCustomGptRole(input(), {
		roleRegistry: state.port,
		async verifyCarrier(value) {
			order.push("verify");
			assert.equal(value.credential, credential);
			assert.equal(value.roleRef, "g-example-agent");
		},
		async createProvisioningHost() {
			return {
				async provisionPackage() {
					order.push("provision");
					return liveResult();
				},
				async finalizeRoleAuth(value) {
					order.push("auth");
					assert.equal(value.credential, credential);
					return { status: "AUTH_UPDATED" as const, gptId: "g-example-agent" };
				},
				async close() {
					order.push("close");
				},
			};
		},
	});
	assert.deepEqual(order, [
		"provision",
		"save",
		"inspect",
		"auth",
		"verify",
		"close",
	]);
	assert.equal(result.gptId, "g-example-agent");
	assert.equal("credential" in result, false);
});

test("createCustomGptRole does not persist or finalize auth when provisioning fails", async () => {
	let saveCalls = 0;
	let deleteCalls = 0;
	let authCalls = 0;
	let verifyCalls = 0;
	const state = registry({
		onSave: () => saveCalls++,
		onDelete: () => deleteCalls++,
	});
	await assert.rejects(
		createCustomGptRole(input(), {
			roleRegistry: state.port,
			async verifyCarrier() {
				verifyCalls++;
			},
			async createProvisioningHost() {
				return {
					async provisionPackage() {
						throw new Error("CREATE_FAILED");
					},
					async finalizeRoleAuth() {
						authCalls++;
						return { status: "AUTH_UPDATED" as const, gptId: "g-never" };
					},
					async close() {},
				};
			},
		}),
		/CREATE_FAILED/,
	);
	assert.deepEqual(
		{ saveCalls, deleteCalls, authCalls, verifyCalls },
		{
			saveCalls: 0,
			deleteCalls: 0,
			authCalls: 0,
			verifyCalls: 0,
		},
	);
});

test("createCustomGptRole removes the newly saved current role when auth finalization fails", async () => {
	const deleted: string[] = [];
	const state = registry({ onDelete: (roleRef) => deleted.push(roleRef) });
	await assert.rejects(
		createCustomGptRole(input(), {
			roleRegistry: state.port,
			async verifyCarrier() {
				throw new Error("VERIFY_MUST_NOT_RUN");
			},
			async createProvisioningHost() {
				return {
					async provisionPackage() {
						return liveResult();
					},
					async finalizeRoleAuth() {
						throw new Error("AUTH_FAILED");
					},
					async close() {},
				};
			},
		}),
		/AUTH_FAILED/,
	);
	assert.deepEqual(deleted, ["g-example-agent"]);
	assert.equal(state.saved.size, 0);
});

test("createCustomGptRole removes the newly saved current role when carrier verification fails", async () => {
	const deleted: string[] = [];
	const state = registry({ onDelete: (roleRef) => deleted.push(roleRef) });
	await assert.rejects(
		createCustomGptRole(input(), {
			roleRegistry: state.port,
			async verifyCarrier() {
				throw new Error("GATEWAY_PROBE_FAILED");
			},
			async createProvisioningHost() {
				return {
					async provisionPackage() {
						return liveResult();
					},
					async finalizeRoleAuth() {
						return {
							status: "AUTH_UPDATED" as const,
							gptId: "g-example-agent",
						};
					},
					async close() {},
				};
			},
		}),
		/GATEWAY_PROBE_FAILED/,
	);
	assert.deepEqual(deleted, ["g-example-agent"]);
	assert.equal(state.saved.size, 0);
});

test("createCustomGptRole serializes simultaneous creates inside one workspace through auth and verification", async () => {
	let activeHosts = 0;
	let maxActiveHosts = 0;
	const state = registry();
	const names = ["agent-a", "agent-b", "agent-c"];
	const results = await Promise.all(
		names.map((name) =>
			createCustomGptRole(input(`@tomflow/${name}`), {
				roleRegistry: state.port,
				async verifyCarrier() {},
				async createProvisioningHost() {
					activeHosts++;
					maxActiveHosts = Math.max(maxActiveHosts, activeHosts);
					return {
						async provisionPackage(value) {
							await new Promise((resolveWait) => setTimeout(resolveWait, 10));
							return liveResult(value.material.packageName);
						},
						async finalizeRoleAuth(value) {
							const gptId = value.carrierUrl.split("/").at(-1) ?? "";
							return { status: "AUTH_UPDATED" as const, gptId };
						},
						async close() {
							activeHosts--;
						},
					};
				},
			}),
		),
	);
	assert.equal(maxActiveHosts, 1);
	assert.equal(results.length, 3);
	assert.equal(state.saved.size, 3);
});

test("createCustomGptRole continues the workspace queue after a failed create", async () => {
	let hostCalls = 0;
	const state = registry();
	const create = (name: string) =>
		createCustomGptRole(input(`@tomflow/${name}`), {
			roleRegistry: state.port,
			async verifyCarrier() {},
			async createProvisioningHost() {
				hostCalls++;
				const call = hostCalls;
				return {
					async provisionPackage(value) {
						if (call === 1) throw new Error("FIRST_CREATE_FAILED");
						return liveResult(value.material.packageName);
					},
					async finalizeRoleAuth(value) {
						const gptId = value.carrierUrl.split("/").at(-1) ?? "";
						return { status: "AUTH_UPDATED" as const, gptId };
					},
					async close() {},
				};
			},
		});
	const [first, second] = await Promise.allSettled([
		create("queue-fail"),
		create("queue-next"),
	]);
	assert.equal(first.status, "rejected");
	assert.equal(second.status, "fulfilled");
	assert.equal(hostCalls, 2);
	assert.equal(state.saved.get("@tomflow/queue-next")?.roleRef, "g-queue-next");
});

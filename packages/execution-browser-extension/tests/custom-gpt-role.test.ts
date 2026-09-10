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
		materialObservation: { source: "CUSTOM_GPT_EDITOR_TEST" },
	};
}

function registry(
	options: {
		onPrepare?: () => void;
		onSave?: () => void;
		onInspect?: () => void;
		onDelete?: (roleRef: string) => void;
		onRollback?: () => void;
	} = {},
) {
	const saved = new Map<string, { roleRef: string; carrierUrl: string }>();
	const port: CustomGptRoleRegistryPort = {
		prepareCredential() {
			options.onPrepare?.();
			return { credential };
		},
		async saveRole(value, preparedCredential) {
			options.onSave?.();
			const previous = saved.get(value.agentPackageRef);
			saved.set(value.agentPackageRef, {
				roleRef: value.roleRef,
				carrierUrl: value.carrierUrl,
			});
			let rollbackAvailable = true;
			return {
				credential: preparedCredential,
				async rollback() {
					if (!rollbackAvailable) throw new Error("ROLLBACK_CONSUMED");
					options.onRollback?.();
					if (previous) saved.set(value.agentPackageRef, previous);
					else saved.delete(value.agentPackageRef);
					rollbackAvailable = false;
				},
			};
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

test("createCustomGptRole configures prepared bearer before create and verifies the activated carrier", async () => {
	const order: string[] = [];
	const state = registry({
		onPrepare: () => order.push("prepare"),
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
				async provisionPackage(value) {
					order.push("provision");
					assert.equal(value.credential, credential);
					return liveResult();
				},
				async finalizeRoleAuth() {
					throw new Error("POST_CREATE_AUTH_MUST_NOT_RUN");
				},
				async close() {
					order.push("close");
				},
			};
		},
	});
	assert.deepEqual(order, [
		"prepare",
		"provision",
		"save",
		"inspect",
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

test("createCustomGptRole preserves the new durable role when post-create carrier verification fails", async () => {
	let rollbackCalls = 0;
	const state = registry({ onRollback: () => rollbackCalls++ });
	state.saved.set(material.packageName, {
		roleRef: "g-previous",
		carrierUrl: "https://chatgpt.com/g/g-previous",
	});
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
					async close() {},
				};
			},
		}),
		/GATEWAY_PROBE_FAILED/,
	);
	assert.equal(rollbackCalls, 0);
	assert.deepEqual(state.saved.get(material.packageName), {
		roleRef: "g-example-agent",
		carrierUrl: "https://chatgpt.com/g/g-example-agent",
	});
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

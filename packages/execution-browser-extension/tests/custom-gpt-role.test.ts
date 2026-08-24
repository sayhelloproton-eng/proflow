import assert from "node:assert/strict";
import { test } from "node:test";

import {
	type CustomGptRoleRegistryPort,
	createCustomGptRole,
} from "../src/custom-gpt-role.ts";

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

function input() {
	return {
		workspaceRoot: "/workspace",
		packageRoot: "/package",
		stagingRoot: "/workspace/.proflow/staging/example-agent",
		gatewayUrl: "https://gateway.example.test",
		material,
	};
}
test("createCustomGptRole persists the exact LIVE_CREATED role", async () => {
	const gptId = "g-public-role-123";
	let saved: unknown;
	let closed = false;
	const registry: CustomGptRoleRegistryPort = {
		async saveRole(value) {
			saved = value;
		},
		inspectRole() {
			return {
				status: "READY",
				role: {
					roleRef: gptId,
					carrierUrl: `https://chatgpt.com/g/${gptId}`,
				},
			};
		},
	};
	const result = await createCustomGptRole(input(), {
		roleRegistry: registry,
		async createProvisioningHost() {
			return {
				async provisionPackage() {
					return {
						status: "LIVE_CREATED" as const,
						packageName: material.packageName,
						version: material.version,
						gptId,
						carrierUrl: `https://chatgpt.com/g/${gptId}`,
						knowledgeBundleSha256: `sha256:${"a".repeat(64)}`,
						knowledgeFiles: [],
					};
				},
				async close() {
					closed = true;
				},
			};
		},
	});
	assert.equal(result.status, "LIVE_CREATED");
	assert.equal(result.gptId, gptId);
	assert.equal(closed, true);
	assert.deepEqual(saved, {
		agentPackageRef: material.packageName,
		registeredPackageVersion: material.version,
		roleRef: gptId,
		carrierUrl: `https://chatgpt.com/g/${gptId}`,
	});
});

test("createCustomGptRole does not persist when provisioning fails", async () => {
	let saveCalls = 0;
	let closed = false;
	const registry: CustomGptRoleRegistryPort = {
		async saveRole() {
			saveCalls += 1;
		},
		inspectRole() {
			throw new Error("INSPECT_MUST_NOT_RUN");
		},
	};
	await assert.rejects(
		createCustomGptRole(input(), {
			roleRegistry: registry,
			async createProvisioningHost() {
				return {
					async provisionPackage() {
						throw new Error("CREATE_FAILED");
					},
					async close() {
						closed = true;
					},
				};
			},
		}),
		/CREATE_FAILED/,
	);
	assert.equal(saveCalls, 0);
	assert.equal(closed, true);
});

test("createCustomGptRole serializes simultaneous creates inside one workspace", async () => {
	let activeHosts = 0;
	let maxActiveHosts = 0;
	const saved = new Map<string, { roleRef: string; carrierUrl: string }>();
	const registry: CustomGptRoleRegistryPort = {
		async saveRole(value) {
			saved.set(value.agentPackageRef, {
				roleRef: value.roleRef,
				carrierUrl: value.carrierUrl,
			});
		},
		inspectRole(value) {
			const role = saved.get(value.agentPackageRef);
			return role ? { status: "READY", role } : { status: "MISSING" };
		},
	};
	const packageNames = ["agent-a", "agent-b", "agent-c"];
	const results = await Promise.all(
		packageNames.map((name) =>
			createCustomGptRole(
				{
					...input(),
					material: { ...material, packageName: `@tomflow/${name}` },
				},
				{
					roleRegistry: registry,
					async createProvisioningHost() {
						activeHosts += 1;
						maxActiveHosts = Math.max(maxActiveHosts, activeHosts);
						return {
							async provisionPackage(value) {
								await new Promise((resolveWait) => setTimeout(resolveWait, 10));
								const gptId = `g-${value.material.packageName.split("/").at(-1)}`;
								return {
									status: "LIVE_CREATED" as const,
									packageName: value.material.packageName,
									version: value.material.version,
									gptId,
									carrierUrl: `https://chatgpt.com/g/${gptId}`,
									knowledgeBundleSha256: `sha256:${"a".repeat(64)}`,
									knowledgeFiles: [],
								};
							},
							async close() {
								activeHosts -= 1;
							},
						};
					},
				},
			),
		),
	);
	assert.equal(maxActiveHosts, 1);
	assert.equal(results.length, 3);
	assert.equal(saved.size, 3);
});

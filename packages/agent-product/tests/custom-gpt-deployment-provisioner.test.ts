import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createWorkspaceRoleSetupClient } from "@tomflow/proflow-agent-runtime/role-management-client";
import {
	provisionCustomGptRole,
	type WorkspaceCustomGptProvisioningPorts,
} from "../src/custom-gpt-deployment-provisioner.ts";

const material = {
	packageName: "@tomflow/proflow-agent-product",
	version: "0.1.13",
	displayName: "Product Agent",
	description: "Product role",
	instructions: "Follow product instructions",
	conversationStarters: ["Start product work"],
	recommendedModel: "gpt-5-6",
	capabilities: {
		webSearch: true,
		imageGeneration: false,
		codeInterpreter: true,
	},
	knowledgeBundle: "knowledge/custom-gpt-knowledge.zip",
	actionSchema: "actions/custom-gpt.openapi.yaml",
};

async function rolePorts(workspaceRoot: string) {
	const client = await createWorkspaceRoleSetupClient(workspaceRoot);
	return {
		async registerRole(input: unknown) {
			return client.registerRole(input);
		},
		inspectRole(input: {
			agentPackageRef: string;
			expectedPackageVersion: string;
		}) {
			return client.inspectRole(input);
		},
	};
}

test("Real-2 LIVE_CREATED is persisted through the Agent Role Registry with the same g-id", async (context) => {
	const workspaceRoot = await mkdtemp(join(tmpdir(), "proflow-live-role-"));
	context.after(() => rm(workspaceRoot, { recursive: true, force: true }));
	const gptId = "g-live-created-123";
	let hostClosed = false;
	const ports: WorkspaceCustomGptProvisioningPorts = {
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
					hostClosed = true;
				},
			};
		},
		createRoleRegistry: rolePorts,
	};
	const result = await provisionCustomGptRole(
		{
			workspaceRoot,
			packageRoot: join(workspaceRoot, "package"),
			stagingRoot: join(workspaceRoot, ".proflow/staging"),
			gatewayUrl: "https://gateway.example.test",
			material,
		},
		ports,
	);
	assert.equal(result.status, "LIVE_CREATED");
	assert.equal(result.gptId, gptId);
	assert.equal(result.carrierUrl, `https://chatgpt.com/g/${gptId}`);
	assert.equal(hostClosed, true);
	const roles = JSON.parse(
		await readFile(join(workspaceRoot, ".proflow/agent/roles.json"), "utf8"),
	) as Array<Record<string, unknown>>;
	assert.deepEqual(roles, [
		{
			agentPackageRef: material.packageName,
			registeredPackageVersion: material.version,
			roleRef: gptId,
			carrierType: "custom-gpt",
			carrierUrl: `https://chatgpt.com/g/${gptId}`,
			registeredAt: roles[0]?.registeredAt,
		},
	]);
	assert.match(String(roles[0]?.registeredAt), /^\d{4}-\d{2}-\d{2}T/);
});

test("Real-2 provisioning failure leaves roles.json byte-for-byte unchanged", async (context) => {
	const workspaceRoot = await mkdtemp(join(tmpdir(), "proflow-failed-role-"));
	context.after(() => rm(workspaceRoot, { recursive: true, force: true }));
	const agentRoot = join(workspaceRoot, ".proflow/agent");
	const rolesPath = join(agentRoot, "roles.json");
	await mkdir(agentRoot, { recursive: true });
	const before = "[]\n";
	await writeFile(rolesPath, before);
	let registerCalls = 0;
	const ports: WorkspaceCustomGptProvisioningPorts = {
		async createProvisioningHost() {
			return {
				async provisionPackage() {
					throw new Error("GPT_EDITOR_PRIVATE_CREATE_TIMEOUT");
				},
				async close() {},
			};
		},
		async createRoleRegistry() {
			registerCalls += 1;
			throw new Error("ROLE_REGISTRY_MUST_NOT_BE_OPENED");
		},
	};
	await assert.rejects(
		provisionCustomGptRole(
			{
				workspaceRoot,
				packageRoot: join(workspaceRoot, "package"),
				stagingRoot: join(workspaceRoot, ".proflow/staging"),
				gatewayUrl: "https://gateway.example.test",
				material,
			},
			ports,
		),
		/GPT_EDITOR_PRIVATE_CREATE_TIMEOUT/,
	);
	assert.equal(registerCalls, 0);
	assert.equal(await readFile(rolesPath, "utf8"), before);
});

test("Real-2 deployment provisioning has no edit-existing recovery path", async () => {
	const source = await readFile(
		new URL("../src/custom-gpt-deployment-provisioner.ts", import.meta.url),
		"utf8",
	);
	assert.doesNotMatch(
		source,
		/gpts\/editor\/\$\{|existingGpt|editExisting|recoveryExisting|fallbackEdit/i,
	);
});

test("Real-2 agent-product Module.setup owns the create-to-workspace production wiring", async () => {
	const adapter = await readFile(
		new URL("../deployment/adapter.ts", import.meta.url),
		"utf8",
	);
	assert.match(adapter, /reality\.status === "MISSING"/);
	assert.match(adapter, /await provisionWorkspaceCustomGptRole\(\{/);
	assert.match(adapter, /readModuleSharedFacts\(context, "agent-gateway"\)/);
	assert.match(adapter, /provisioningStatus: result\.status/);
	assert.doesNotMatch(adapter, /gpts\/editor\/\$\{|editExisting|fallbackEdit/i);
});

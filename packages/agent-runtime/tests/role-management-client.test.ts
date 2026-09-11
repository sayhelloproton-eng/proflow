import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
	hasCurrentRoleCarrierValidationEvidence,
	recordRoleCarrierValidationEvidence,
	validateLocalRoleOpenApi,
	validateRoleCarrier,
} from "../src/role-management-client.ts";

const openApi = `openapi: 3.1.0
info:
  title: Role Validation
  version: 1.0.0
paths:
  /actions/getTask:
    get:
      operationId: getTask
      responses:
        '200': { description: ok }
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
security:
  - bearerAuth: []
`;

test("CP-AGT-RUNTIME-11 role carrier validation parses local OpenAPI and proves Gateway health + role-key recognition without a business side effect", async (context) => {
	const credential = "role-secret-that-is-long-enough-for-validation";
	const server = createServer((request, response) => {
		response.setHeader("content-type", "application/json");
		if (request.url === "/health") {
			response.end(JSON.stringify({ status: "UP" }));
			return;
		}
		if (request.url?.startsWith("/actions/getTask")) {
			if (request.headers.authorization !== `Bearer ${credential}`) {
				response.statusCode = 401;
				response.end(JSON.stringify({ error: "AUTHENTICATION_FAILED" }));
				return;
			}
			// A missing synthetic Task is the expected read-only downstream response.
			response.statusCode = 400;
			response.end(JSON.stringify({ error: "TASK_NOT_FOUND" }));
			return;
		}
		response.statusCode = 404;
		response.end(JSON.stringify({ error: "NOT_FOUND" }));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	context.after(
		() => new Promise<void>((resolve) => server.close(() => resolve())),
	);
	const address = server.address();
	if (!address || typeof address === "string")
		assert.fail("missing server port");
	const gatewayUrl = `http://127.0.0.1:${address.port}`;

	assert.deepEqual(validateLocalRoleOpenApi(openApi), []);
	assert.deepEqual(
		await validateRoleCarrier({ gatewayUrl, credential, openApiText: openApi }),
		{ status: "FAIL", issues: ["ROLE_CARRIER_MATERIAL_UNVERIFIED"], materialObservation: undefined },
	);
	let transientActionAttempts = 0;
	const transientActionFetch: typeof globalThis.fetch = async (
		request,
		init,
	) => {
		if (
			String(request).includes("/actions/getTask") &&
			transientActionAttempts++ === 0
		)
			throw new TypeError("TRANSIENT_NETWORK_FAILURE");
		return globalThis.fetch(request, init);
	};
	assert.deepEqual(
		await validateRoleCarrier(
			{ gatewayUrl, credential, openApiText: openApi },
			{ fetch: transientActionFetch, retryDelayMs: 0 },
		),
		{ status: "FAIL", issues: ["ROLE_CARRIER_MATERIAL_UNVERIFIED"], materialObservation: undefined },
	);
	assert.equal(transientActionAttempts, 2);
	let rejectedActionAttempts = 0;
	const rejected = await validateRoleCarrier(
		{
			gatewayUrl,
			credential: "wrong-role-key",
			openApiText: openApi,
		},
		{
			fetch: async (request, init) => {
				if (String(request).includes("/actions/getTask"))
					rejectedActionAttempts += 1;
				return globalThis.fetch(request, init);
			},
			retryDelayMs: 0,
		},
	);
	assert.equal(rejected.status, "FAIL");
	assert.ok(rejected.issues.includes("GATEWAY_ROLE_KEY_REJECTED"));
	assert.equal(rejectedActionAttempts, 1);
	assert.deepEqual(validateLocalRoleOpenApi("not: [valid"), [
		"OPENAPI_PARSE_FAILED",
	]);
});

test("CP-AGT-RUNTIME-12 carrier validation evidence is exact and secret-free", async (context) => {
	const workspaceRoot = await mkdtemp(join(tmpdir(), "proflow-role-carrier-"));
	context.after(() => rm(workspaceRoot, { recursive: true, force: true }));
	const expectedMaterial = {
		packageName: "@tomflow/proflow-agent-test-ops", version: "0.1.15", displayName: "Test", description: "Test role", instructions: "Use localDev.", actionSchema: openApi,
		conversationStarters: ["Test"], recommendedModel: "gpt-5-6", capabilities: { webSearch: true, imageGeneration: true, codeInterpreter: true }, requirements: { actions: "required" as const }, knowledgeBundleSha256: `sha256:${"a".repeat(64)}`,
	};
	const publishedMaterial = {
		displayName: expectedMaterial.displayName,
		description: expectedMaterial.description,
		instructions: expectedMaterial.instructions,
		actionSchema: expectedMaterial.actionSchema,
		conversationStarters: expectedMaterial.conversationStarters,
		recommendedModel: expectedMaterial.recommendedModel,
		capabilities: expectedMaterial.capabilities,
	};
	const evidence = {
		expectedMaterial,
		materialObservation: { contract: "proflow.role-carrier-material-observation.v1", source: "LIVE_CARRIER", roleRef: "g-test-ops", carrierUrl: "https://chatgpt.com/g/g-test-ops", observedAt: new Date().toISOString(), material: publishedMaterial },
		workspaceRoot,
		agentPackageRef: "@tomflow/proflow-agent-test-ops",
		registeredPackageVersion: "0.1.15",
		roleRef: "g-test-ops",
		carrierUrl: "https://chatgpt.com/g/g-test-ops",
		gatewayUrl: "https://gateway.example.test/",
	};
	assert.equal(await hasCurrentRoleCarrierValidationEvidence(evidence), false);
	await assert.rejects(recordRoleCarrierValidationEvidence({ ...evidence, materialObservation: undefined }), /ROLE_CARRIER_MATERIAL_UNVERIFIED/);
	const validation = await validateRoleCarrier({ expectedMaterial, roleRef: evidence.roleRef, carrierUrl: evidence.carrierUrl, gatewayUrl: evidence.gatewayUrl, credential: "fixture-role-key", openApiText: openApi }, {
		readLiveMaterial: async () => evidence.materialObservation,
		fetch: async (input) => new Response("{}", { status: String(input).endsWith("/health") ? 200 : 400 }),
	});
	assert.equal(validation.status, "PASS");
	const denied = await validateRoleCarrier({ expectedMaterial, roleRef: evidence.roleRef, carrierUrl: evidence.carrierUrl, gatewayUrl: evidence.gatewayUrl, credential: "fixture-role-key", openApiText: openApi }, {
		readLiveMaterial: async () => evidence.materialObservation,
		fetch: async (input) => new Response("{}", { status: String(input).endsWith("/health") ? 200 : 403 }),
	});
	assert.ok(denied.issues.includes("GATEWAY_ROLE_OPERATION_DENIED"));
	await recordRoleCarrierValidationEvidence(evidence);
	assert.equal(await hasCurrentRoleCarrierValidationEvidence(evidence), true);
	for (const changed of [
		{ roleRef: "g-other" },
		{ registeredPackageVersion: "0.1.16" },
		{ carrierUrl: "https://chatgpt.com/g/g-other" },
		{ gatewayUrl: "https://gateway-other.example.test/" },
		{ expectedMaterial: { ...expectedMaterial, instructions: "old instructions" } },
	]) {
		assert.equal(
			await hasCurrentRoleCarrierValidationEvidence({
				...evidence,
				...changed,
			}),
			false,
		);
	}
	const evidencePath = join(
		workspaceRoot,
		".proflow",
		"state",
		"agent",
		"role-carrier-validation",
		`${encodeURIComponent(evidence.agentPackageRef)}.json`,
	);
	const persisted = await readFile(evidencePath, "utf8");
	assert.doesNotMatch(persisted, /credential|secret|bearer/i);
	for (const ageMs of [2 * 60_000, 6 * 60_000, 7 * 24 * 60 * 60_000]) {
		await writeFile(
			evidencePath,
			JSON.stringify({
				...JSON.parse(persisted),
				observedAt: new Date(Date.now() - ageMs).toISOString(),
			}),
		);
		assert.equal(await hasCurrentRoleCarrierValidationEvidence(evidence), true);
	}
	await writeFile(
		evidencePath,
		JSON.stringify({ ...JSON.parse(persisted), observedAt: "not-a-date" }),
	);
	assert.equal(await hasCurrentRoleCarrierValidationEvidence(evidence), false);
	await writeFile(evidencePath, JSON.stringify({ ...JSON.parse(persisted), contract: "proflow.role-carrier-validation.v1" }));
	assert.equal(await hasCurrentRoleCarrierValidationEvidence(evidence), false);
});

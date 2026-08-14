import assert from "node:assert/strict";
import { test } from "node:test";
import { createAgentGateway } from "../src/index.ts";

const fixtureCredential = "fixture-credential";

async function fixture(
	overrides: Record<string, unknown> = {},
	options: Record<string, unknown> = {},
) {
	const routes: Array<{
		operationId: string;
		roleRef: string;
		input: unknown;
	}> = [];
	const gateway = await createAgentGateway({
		relayBaseUrl: "https://gateway.example/relay/",
		owners: {
			async authenticateBearer(credential) {
				if (credential !== fixtureCredential)
					throw new Error("AUTHENTICATION_FAILED");
				return "g-authenticated";
			},
			async route(operationId, roleRef, input) {
				routes.push({ operationId, roleRef, input });
				if (operationId === "overloaded")
					throw Object.assign(new Error("overloaded"), { httpStatus: 429 });
				if (operationId === "broken") throw new Error("owner failed");
				return { ok: true, operationId, roleRef, input };
			},
			async lookupResult(operationId) {
				return { recovered: operationId };
			},
			async readiness() {
				return {
					credentialStore: true,
					agent: true,
					task: true,
					execution: true,
					relay: true,
					...overrides,
				};
			},
		},
		...options,
	});
	const address = await gateway.start();
	return { gateway, routes, baseUrl: `http://${address.host}:${address.port}` };
}
async function action(
	baseUrl: string,
	body: unknown,
	credential = fixtureCredential,
) {
	return fetch(`${baseUrl}/actions`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${credential}`,
		},
		body: JSON.stringify(body),
	});
}
test("CP-AGT-GW-01 bearer owns role identity and unknown input is validated", async () => {
	const { gateway, routes, baseUrl } = await fixture();
	const response = await action(baseUrl, {
		operationId: "getTask",
		body: { roleRef: "g-spoof", taskId: "task:1" },
	});
	assert.equal(response.status, 200);
	assert.equal(routes[0]?.roleRef, "g-authenticated");
	assert.deepEqual(routes[0]?.input, { taskId: "task:1" });
	assert.equal((await action(baseUrl, { body: {} })).status, 400);
	assert.equal(
		(await action(baseUrl, { operationId: "getTask", body: {} }, "bad")).status,
		401,
	);
	await gateway.stop();
});
test("CP-AGT-GW-02 body/path/query normalize without arbitrary custom headers", async () => {
	const { gateway, routes, baseUrl } = await fixture();
	await fetch(`${baseUrl}/actions/getTask?taskId=task%3A2`, {
		headers: { authorization: `Bearer ${fixtureCredential}` },
	});
	assert.deepEqual(routes[0], {
		operationId: "getTask",
		roleRef: "g-authenticated",
		input: { taskId: "task:2" },
	});
	await gateway.stop();
});

test("CP-AGT-GW-02 static OpenAPI POST path maps directly to its canonical operation", async () => {
	const { gateway, routes, baseUrl } = await fixture();
	try {
		const response = await fetch(`${baseUrl}/actions/createTask`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${fixtureCredential}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				roleRef: "g-spoofed",
				title: "real transport shape",
			}),
		});
		assert.equal(response.status, 200);
		assert.deepEqual(routes.at(-1), {
			operationId: "createTask",
			roleRef: "g-authenticated",
			input: { title: "real transport shape" },
		});
	} finally {
		await gateway.stop();
	}
});
test("CP-AGT-GW-03 request response budgets and real 429/5xx semantics", async () => {
	const { gateway, baseUrl } = await fixture();
	assert.equal(
		(
			await action(baseUrl, {
				operationId: "getTask",
				body: { value: "x".repeat(100_000) },
			})
		).status,
		413,
	);
	assert.equal(
		(await action(baseUrl, { operationId: "overloaded", body: {} })).status,
		429,
	);
	assert.equal(
		(await action(baseUrl, { operationId: "broken", body: {} })).status,
		500,
	);
	await gateway.stop();
	const timed = await fixture(
		{},
		{
			actionTimeoutMs: 20,
			owners: {
				async authenticateBearer() {
					return "g-authenticated";
				},
				async route() {
					return new Promise(() => {});
				},
				async readiness() {
					return {
						credentialStore: true,
						agent: true,
						task: true,
						execution: true,
						relay: true,
					};
				},
			},
		},
	);
	assert.equal(
		(await action(timed.baseUrl, { operationId: "slow", body: {} })).status,
		504,
	);
	await timed.gateway.stop();
});
test("CP-AGT-GW-04 file input count is bounded and normalization maps to Execution descriptors without fetching", async () => {
	const { gateway } = await fixture();
	assert.throws(
		() =>
			gateway.normalizeFileInputs(
				Array.from({ length: 11 }, (_, index) => ({
					name: `f${index}.txt`,
					id: String(index),
					mime_type: "text/plain",
					download_link: `https://files.example/${index}`,
				})),
			),
		/OPENAI_FILE_COUNT_EXCEEDED/,
	);
	// Gateway no longer owns physical remote file fetch/materialization; the bytes are
	// fetched by the Execution owner via its Public Contract, so the Gateway exposes
	// no fetch surface of its own.
	assert.equal("fetchFileInputs" in gateway, false);
	assert.equal("verifyResolvedRemoteUrl" in gateway, false);
	const normalized = gateway.normalizeFileInputs([
		{
			name: "small.txt",
			id: "1",
			mime_type: "text/plain",
			download_link: "https://files.example/small",
		},
	]);
	assert.deepEqual(normalized, [
		{
			name: "small.txt",
			id: "1",
			mime_type: "text/plain",
			download_link: "https://files.example/small",
		},
	]);
	await gateway.stop();
});
test("CP-AGT-GW-05 URL SSRF and filename path control fail closed at ingress normalization", async () => {
	const { gateway } = await fixture();
	for (const url of [
		"http://example.com/a",
		"https://127.0.0.1/a",
		"https://10.0.0.1/a",
		"https://169.254.169.254/latest/meta-data",
		"file:///tmp/a",
	])
		assert.throws(
			() => gateway.assertSafeRemoteUrl(url),
			/OPENAI_FILE_INPUT_INVALID/,
		);
	assert.throws(
		() =>
			gateway.normalizeFileInputs([
				{
					name: "../secret",
					id: "1",
					mime_type: "text/plain",
					download_link: "https://files.example/a",
				},
			]),
		/OPENAI_FILE_INPUT_INVALID/,
	);
	// Redirect/link-local/metadata DNS rebinding and MIME-vs-content checks are
	// physical fetch/materialization safety owned by the Execution Public Contract
	// (Batch 1 network hardening), not by the Gateway package.
	assert.equal("fetchFileInputs" in gateway, false);
	assert.equal("resolveHostname" in gateway, false);
	await gateway.stop();
});
test("CP-AGT-GW-06 relay token is opaque GET-only scoped TTL and header safe", async () => {
	let currentTime = 1_000;
	const gateway = await createAgentGateway({
		relayBaseUrl: "https://gateway.example/relay/",
		now: () => currentTime,
		owners: {
			async authenticateBearer() {
				return "g";
			},
			async route() {
				return {};
			},
			async readiness() {
				return {
					credentialStore: true,
					agent: true,
					task: true,
					execution: true,
					relay: true,
				};
			},
		},
	});
	const artifact = {
		artifactRef: "artifact:secret-path",
		name: "report.txt",
		mimeType: "text/plain",
		bytes: Buffer.from("report"),
	};
	const relayed = gateway.createRelay(artifact);
	assert.doesNotMatch(relayed.url, /artifact|secret-path/);
	assert.equal(
		(await gateway.readRelay(relayed.token, "GET", "artifact:secret-path"))
			.headers["content-disposition"],
		'attachment; filename="report.txt"',
	);
	await assert.rejects(
		() => gateway.readRelay(relayed.token, "POST", "artifact:secret-path"),
		/OPENAI_FILE_RELAY_SCOPE_INVALID/,
	);
	await assert.rejects(
		() => gateway.readRelay(relayed.token, "GET", "artifact:other"),
		/OPENAI_FILE_RELAY_SCOPE_INVALID/,
	);
	currentTime += 300_001;
	await assert.rejects(
		() => gateway.readRelay(relayed.token, "GET", "artifact:secret-path"),
		/OPENAI_FILE_RELAY_EXPIRED/,
	);
	const small = gateway.serializeFileResponse([
		{
			artifactRef: "artifact:small",
			name: "small.txt",
			mimeType: "text/plain",
			bytes: Buffer.from("small"),
		},
	]);
	assert.equal(small.openaiFileResponse[0]?.kind, "inline");
	const large = gateway.serializeFileResponse([
		{
			artifactRef: "artifact:large",
			name: "large.txt",
			mimeType: "text/plain",
			bytes: Buffer.alloc(80_000),
		},
	]);
	assert.equal(large.openaiFileResponse[0]?.kind, "url");
	assert.ok(JSON.stringify(large).length < 100_000);
	assert.throws(
		() =>
			gateway.serializeFileResponse(
				Array.from({ length: 11 }, (_, index) => ({
					artifactRef: `artifact:${index}`,
					name: `${index}.txt`,
					mimeType: "text/plain",
					bytes: Buffer.from("x"),
				})),
			),
		/OPENAI_FILE_COUNT_EXCEEDED/,
	);
});

test("CP-AGT-GW-06 relay is a real unauthenticated opaque HTTP download with strict artifact scope", async () => {
	const { gateway, baseUrl } = await fixture();
	try {
		const relay = gateway.createRelay({
			artifactRef: "artifact:real-http",
			name: "proof.txt",
			mimeType: "text/plain",
			bytes: Buffer.from("bounded proof"),
		});
		const external = new URL(relay.url);
		const response = await fetch(
			`${baseUrl}${external.pathname}${external.search}`,
		);
		assert.equal(response.status, 200);
		assert.equal(await response.text(), "bounded proof");
		assert.equal(response.headers.get("cache-control"), "private, no-store");
		assert.equal(response.headers.get("x-content-type-options"), "nosniff");
		const wrongScope = new URL(external);
		wrongScope.searchParams.set("artifactRef", "artifact:wrong");
		assert.equal(
			(await fetch(`${baseUrl}${wrongScope.pathname}${wrongScope.search}`))
				.status,
			404,
		);
		assert.equal(
			(
				await fetch(`${baseUrl}${external.pathname}${external.search}`, {
					method: "POST",
				})
			).status,
			404,
		);
	} finally {
		await gateway.stop();
	}
});
test("CP-AGT-GW-07 every operation has explicit consequential metadata independent from approval", async () => {
	const { gateway } = await fixture();
	const schema = gateway.describeOpenApi();
	for (const path of Object.values(schema.paths) as Array<
		Record<string, Record<string, unknown>>
	>)
		for (const operation of Object.values(path))
			assert.equal(typeof operation["x-openai-isConsequential"], "boolean");
	assert.doesNotMatch(JSON.stringify(schema), /executionApproval|approvalRef/);
	await gateway.stop();
});
test("CP-AGT-GW-08 gateway has no business persistence and uncertainty looks up owner result", async () => {
	const { gateway, baseUrl } = await fixture();
	const response = await action(baseUrl, {
		operationId: "lookupAfterUncertain",
		body: { idempotencyKey: "same" },
		uncertain: true,
	});
	assert.deepEqual(await response.json(), {
		recovered: "lookupAfterUncertain",
	});
	assert.deepEqual(gateway.businessPersistence, []);
	await gateway.stop();
});
test("CP-AGT-GW-09 readiness blocks missing dependencies and restart replays zero mutation", async () => {
	const { gateway, routes } = await fixture({ relay: false });
	assert.equal((await gateway.readiness()).status, "NOT_READY");
	await gateway.restart();
	assert.equal(routes.length, 0);
	await gateway.stop();
});

test("CP-AGT-GW-09 HTTP health and readiness expose only service and dependency status", async () => {
	const { gateway, baseUrl } = await fixture({ execution: false });
	try {
		const health = await fetch(`${baseUrl}/health`);
		assert.equal(health.status, 200);
		assert.deepEqual(await health.json(), { status: "UP" });
		const ready = await fetch(`${baseUrl}/ready`);
		assert.equal(ready.status, 503);
		assert.deepEqual(await ready.json(), {
			status: "NOT_READY",
			checks: {
				credentialStore: true,
				agent: true,
				task: true,
				execution: false,
				relay: true,
				ingress: true,
			},
		});
	} finally {
		await gateway.stop();
	}
});

test("B2-GW-03 readiness reflects real lifecycle rather than a hardcoded ingress", async () => {
	const gateway = await createAgentGateway({
		relayBaseUrl: "https://gateway.example/relay/",
		owners: {
			async authenticateBearer() {
				return "g";
			},
			async route() {
				return {};
			},
			async readiness() {
				return { credentialStore: true, downstream: true };
			},
		},
	});
	assert.equal((await gateway.readiness()).status, "NOT_READY");
	assert.equal((await gateway.readiness()).checks.ingress, false);

	await gateway.start();
	assert.equal((await gateway.readiness()).status, "READY");
	assert.equal((await gateway.readiness()).checks.ingress, true);
	assert.equal((await gateway.readiness()).checks.relay, true);

	await gateway.stop();
	assert.equal((await gateway.readiness()).status, "NOT_READY");
	assert.equal((await gateway.readiness()).checks.ingress, false);
});

test("B2-GW-03 invalid relay base URL blocks readiness", async () => {
	const gateway = await createAgentGateway({
		relayBaseUrl: "http://gateway.example/relay/",
		owners: {
			async authenticateBearer() {
				return "g";
			},
			async route() {
				return {};
			},
			async readiness() {
				return { credentialStore: true, downstream: true };
			},
		},
	});
	await gateway.start();
	assert.equal((await gateway.readiness()).status, "NOT_READY");
	assert.equal((await gateway.readiness()).checks.relay, false);
	await gateway.stop();
});

test("B2-GW-01 putTaskDocument openaiFileIdRefs normalizes to owner-neutral File Bridge input without fetching", async () => {
	const captures: Array<{
		operationId: string;
		roleRef: string;
		input: unknown;
		context: unknown;
	}> = [];
	const gateway = await createAgentGateway({
		relayBaseUrl: "https://gateway.example/relay/",
		owners: {
			async authenticateBearer(credential) {
				if (credential !== fixtureCredential)
					throw new Error("AUTHENTICATION_FAILED");
				return "g-authenticated";
			},
			async route(operationId, roleRef, input, context) {
				captures.push({ operationId, roleRef, input, context });
				return { ok: true, operationId };
			},
			async readiness() {
				return {
					credentialStore: true,
					agent: true,
					task: true,
					execution: true,
					relay: true,
				};
			},
		},
	});
	const address = await gateway.start();
	const baseUrl = `http://${address.host}:${address.port}`;
	const put = (body: unknown) =>
		fetch(`${baseUrl}/actions/putTaskDocument`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${fixtureCredential}`,
				"content-type": "application/json",
			},
			body: JSON.stringify(body),
		});
	try {
		const response = await put({
			openaiFileIdRefs: [
				{
					name: "spec.txt",
					id: "file-abc",
					mime_type: "text/plain",
					download_link: "https://files.example/spec.txt",
				},
			],
			taskId: "task:file-bridge",
			nodeId: "node:1",
			documentType: "input",
			expectedTaskVersion: 2,
			idempotencyKey: "bridge-put",
		});
		assert.equal(response.status, 200);
		assert.equal(captures.length, 1);
		// The OpenAI file DTO is stripped from the canonical Task body.
		assert.equal(captures[0]?.operationId, "putTaskDocument");
		assert.equal(captures[0]?.roleRef, "g-authenticated");
		assert.deepEqual(captures[0]?.input, {
			taskId: "task:file-bridge",
			nodeId: "node:1",
			documentType: "input",
			expectedTaskVersion: 2,
			idempotencyKey: "bridge-put",
		});
		// The owner-neutral File Bridge input carries only provenance/MIME/source;
		// the OpenAI download_link never crosses the Gateway boundary.
		const firstCapture = captures[0];
		assert.ok(firstCapture, "expected one captured route");
		const fileInputs = (
			firstCapture.context as { fileMaterializationInputs?: unknown }
		).fileMaterializationInputs;
		assert.deepEqual(fileInputs, [
			{
				name: "spec.txt",
				provenanceRef: "file-abc",
				declaredMimeType: "text/plain",
				sourceUrl: "https://files.example/spec.txt",
			},
		]);
		// Inline content plus a file reference is an ambiguous request and fails closed.
		assert.equal(
			(
				(await put({
					openaiFileIdRefs: [
						{
							name: "a.txt",
							id: "file-1",
							mime_type: "text/plain",
							download_link: "https://files.example/a",
						},
					],
					content: "inline bytes",
					taskId: "task:file-bridge",
					nodeId: "node:1",
				}).then((r) => r.json())) as { error: string }
			).error,
			"OPENAI_FILE_INPUT_CONFLICT",
		);
		// More than one file is rejected.
		assert.equal(
			(
				(await put({
					openaiFileIdRefs: [
						{
							name: "a.txt",
							id: "file-1",
							mime_type: "text/plain",
							download_link: "https://files.example/a",
						},
						{
							name: "b.txt",
							id: "file-2",
							mime_type: "text/plain",
							download_link: "https://files.example/b",
						},
					],
					taskId: "task:file-bridge",
					nodeId: "node:1",
				}).then((r) => r.json())) as { error: string }
			).error,
			"OPENAI_FILE_COUNT_EXCEEDED",
		);
		// File references are only valid on putTaskDocument.
		const unsupported = await fetch(`${baseUrl}/actions/createTask`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${fixtureCredential}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				openaiFileIdRefs: [
					{
						name: "a.txt",
						id: "file-1",
						mime_type: "text/plain",
						download_link: "https://files.example/a",
					},
				],
				taskId: "task:file-bridge",
			}),
		});
		assert.equal(
			((await unsupported.json()) as { error: string }).error,
			"OPENAI_FILE_INPUT_UNSUPPORTED_OPERATION",
		);
		// The Gateway owns normalization only; it exposes no physical fetch surface.
		assert.equal("fetchFileInputs" in gateway, false);
		assert.equal("materializeExternalFiles" in gateway, false);
	} finally {
		await gateway.stop();
	}
});

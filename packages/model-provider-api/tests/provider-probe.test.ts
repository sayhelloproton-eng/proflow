import assert from "node:assert/strict";
import { test } from "node:test";

import { probeProvider } from "../src/resource-adapter.ts";

test("provider probe validates generic /v1/models inventory instead of trusting HTTP 200", async () => {
	const calls: string[] = [];
	const valid = await probeProvider({
		baseUrl: "http://provider.example:4400",
		fetch: async (input) => {
			calls.push(String(input));
			return Response.json({
				object: "list",
				data: [{ id: "model-a", object: "model" }],
			});
		},
	});
	assert.equal(valid.status, "READY");
	assert.equal(valid.baseUrl, "http://provider.example:4400/v1");
	assert.deepEqual(
		valid.models.map((model) => model.id),
		["model-a"],
	);
	assert.deepEqual(calls, ["http://provider.example:4400/v1/models"]);

	const invalid = await probeProvider({
		baseUrl: "http://provider.example:4400",
		fetch: async () => Response.json({ ok: true }),
	});
	assert.equal(invalid.status, "PROTOCOL_INVALID");
});

test("provider probe accepts a root /models inventory when /v1/models is absent", async () => {
	const calls: string[] = [];
	const result = await probeProvider({
		baseUrl: "https://provider.example/api",
		fetch: async (input) => {
			calls.push(String(input));
			return calls.length === 1
				? new Response(null, { status: 404 })
				: Response.json({ data: [{ id: "root-model" }] });
		},
	});
	assert.equal(result.status, "READY");
	assert.equal(result.baseUrl, "https://provider.example/api");
	assert.deepEqual(calls, [
		"https://provider.example/api/v1/models",
		"https://provider.example/api/models",
	]);
});

test("provider probe distinguishes auth and transport failures without leaking credentials", async () => {
	const secret = "TOP_SECRET_PROVIDER_TOKEN";
	const denied = await probeProvider({
		baseUrl: "https://provider.example",
		credential: secret,
		fetch: async (_input, init) => {
			assert.ok(init?.headers instanceof Headers);
			assert.equal(init.headers.get("authorization"), `Bearer ${secret}`);
			return new Response(null, { status: 401 });
		},
	});
	assert.equal(denied.status, "AUTH_FAILED");
	assert.doesNotMatch(JSON.stringify(denied), new RegExp(secret));

	const unreachable = await probeProvider({
		baseUrl: "https://provider.example",
		fetch: async () => {
			throw new Error(`connect failed ${secret}`);
		},
	});
	assert.equal(unreachable.status, "UNREACHABLE");
	assert.equal(unreachable.message, "provider API request failed");
	assert.equal(unreachable.reachable, false);
});

test("provider probe is implementation agnostic", async () => {
	const result = await probeProvider({
		baseUrl: "https://generic.provider.example/v1",
		fetch: async () => Response.json({ data: [{ id: "model-x" }] }),
	});
	assert.equal(result.status, "READY");
	assert.doesNotMatch(
		JSON.stringify(result),
		/providerIdentity|serviceType|hostname|providerInstance|discovery/i,
	);
});

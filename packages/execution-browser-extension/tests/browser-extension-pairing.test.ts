import assert from "node:assert/strict";
import { test } from "node:test";

const token = "pairing-token-that-is-longer-than-thirty-two-characters";
const extensionId = "b".repeat(32);
const origin = `chrome-extension://${extensionId}`;

async function pairingModule() {
	return import("../src/pairing.ts");
}

function request(
	endpoint: string,
	path: string,
	init: RequestInit = {},
	headers: Record<string, string> = {},
) {
	return fetch(`${endpoint}${path}`, {
		...init,
		headers: {
			authorization: `Bearer ${token}`,
			origin,
			"content-type": "application/json",
			...headers,
		},
	});
}

test("CP-EXE-BR-16 pairing binds identity only after authenticated hello + heartbeat", async () => {
	const { createBrowserExtensionPairingServer } = await pairingModule();
	const pairing = await createBrowserExtensionPairingServer({ token });
	try {
		const unauthenticated = await fetch(
			`${pairing.endpoint}/v1/session/hello`,
			{
				method: "POST",
				body: "{}",
			},
		);
		assert.equal(unauthenticated.status, 401);

		const mismatched = await request(pairing.endpoint, "/v1/session/hello", {
			method: "POST",
			body: JSON.stringify({
				extensionId: "c".repeat(32),
				extensionInstanceId: "extension:first",
			}),
		});
		assert.equal(mismatched.status, 401);

		const hello = await request(pairing.endpoint, "/v1/session/hello", {
			method: "POST",
			body: JSON.stringify({
				extensionId,
				extensionInstanceId: "extension:first",
			}),
		});
		assert.equal(hello.status, 200);
		assert.equal(pairing.status().paired, false);

		const paired = pairing.waitForPairing();
		const heartbeat = await request(
			pairing.endpoint,
			"/v1/session/heartbeat?extensionInstanceId=extension%3Afirst",
			{ method: "POST", body: "{}" },
		);
		assert.equal(heartbeat.status, 200);
		assert.deepEqual(await paired, {
			extensionId,
			extensionInstanceId: "extension:first",
		});
		assert.equal(pairing.status().paired, true);

		const empty = await request(
			pairing.endpoint,
			"/v1/commands/next?extensionInstanceId=extension%3Afirst",
		);
		assert.equal(empty.status, 204);
	} finally {
		await pairing.close();
	}
});

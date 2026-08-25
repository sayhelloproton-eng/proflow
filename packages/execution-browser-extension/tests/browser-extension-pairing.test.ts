import assert from "node:assert/strict";
import { once } from "node:events";
import { createConnection } from "node:net";
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

test("pairing close is bounded when a browser keeps an HTTP request active", async () => {
	const { createBrowserExtensionPairingServer } = await pairingModule();
	const pairing = await createBrowserExtensionPairingServer({ token });
	const url = new URL(pairing.endpoint);
	const socket = createConnection({
		host: url.hostname,
		port: Number(url.port),
	});
	try {
		await once(socket, "connect");
		socket.write(
			[
				"POST /v1/session/hello HTTP/1.1",
				`Host: ${url.host}`,
				`Origin: ${origin}`,
				`Authorization: Bearer ${token}`,
				"Content-Type: application/json",
				"Content-Length: 1024",
				"Connection: keep-alive",
				"",
				"{",
			].join("\r\n"),
		);
		await new Promise((resolve) => setTimeout(resolve, 25));
		await Promise.race([
			pairing.close(),
			new Promise((_, reject) =>
				setTimeout(
					() => reject(new Error("PAIRING_CLOSE_DID_NOT_FINISH")),
					750,
				),
			),
		]);
	} finally {
		socket.destroy();
		await pairing.close();
	}
});

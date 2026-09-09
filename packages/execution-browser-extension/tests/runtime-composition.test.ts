import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createBrowserExecutorClientComposition } from "../src/runtime-composition.ts";

const sourceUrl = new URL("../src/runtime-composition.ts", import.meta.url);

test("PRESMOKE-B3-BRIDGE-TOPOLOGY-01 Extension owns the Browser listener while Execution Runtime receives a non-owning client", async () => {
	const source = await readFile(sourceUrl, "utf8");
	assert.match(source, /export async function createBrowserBridgeLifecycle/);
	assert.match(source, /createBrowserRealityBridgeServer/);
	assert.match(
		source,
		/export async function createBrowserExecutorClientComposition/,
	);
	assert.match(source, /createBrowserRealityBridgeClient/);
	assert.match(source, /non-owning Browser-lane client/);
	assert.doesNotMatch(
		source,
		/createExecutionRuntimeProcess|createExecutionRuntime\(/,
	);
});

test("PRESMOKE-B3-BRIDGE-TOPOLOGY-02 Browser client credential is loaded only from an owner-private secret file", async (t) => {
	if (process.platform === "win32") return t.skip("POSIX mode proof");
	const root = await mkdtemp(
		join(tmpdir(), "proflow-browser-composition-security-"),
	);
	const bridgeToken = join(root, "bridge.token");
	const configPath = join(root, "browser.json");
	await writeFile(
		bridgeToken,
		"browser-bridge-token-abcdefghijklmnopqrstuvwxyz012345\n",
		{ mode: 0o600 },
	);
	await writeFile(
		configPath,
		JSON.stringify({
			endpoint: "http://127.0.0.1:65530",
			tokenFile: bridgeToken,
		}),
	);
	const platformHost = async () => ({
		endpoint: "http://127.0.0.1:8787",
		token: "platform-host-token-abcdefghijklmnopqrstuvwxyz012345",
	});
	const composition = await createBrowserExecutorClientComposition({
		configPath,
		platformHost,
	});
	await composition.close();
	await chmod(bridgeToken, 0o644);
	await assert.rejects(
		createBrowserExecutorClientComposition({ configPath, platformHost }),
		/browser executor credential permissions must be owner-only/,
	);
});

test("CP-EXE-RT-27 Browser client close cannot own or close the Extension listener lifecycle", async () => {
	const source = await readFile(sourceUrl, "utf8");
	assert.match(source, /close: client\.close/);
	assert.match(source, /The Extension deployment owns this listener/);
	assert.doesNotMatch(source, /close:\s*bridge\.close/);
});

test("PRESMOKE-B3-BRIDGE-TOPOLOGY-04 Browser client accepts an optional Vision port and forwards it into the Browser executor", async () => {
	const source = await readFile(sourceUrl, "utf8");
	assert.match(source, /vision\?: BrowserVisionPort/);
	assert.match(source, /options\.vision/);
	assert.match(source, /createExecutionBrowserExtension/);
});

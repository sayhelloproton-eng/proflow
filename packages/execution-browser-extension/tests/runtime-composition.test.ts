import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { loadBrowserExecutorCompositionConfig } from "../src/runtime-composition.ts";

const sourceUrl = new URL("../src/runtime-composition.ts", import.meta.url);

test("PRESMOKE-B3-BRIDGE-TOPOLOGY-01 Browser adapter composes Reality Bridge + Browser Executor without creating a second Execution Runtime", async () => {
	const source = await readFile(sourceUrl, "utf8");
	assert.match(source, /createBrowserRealityBridgeServer/);
	assert.match(source, /createExecutionBrowserExtension/);
	assert.match(source, /browserExecutor/);
	assert.match(source, /browser\.binding/);
	assert.match(source, /browser\.bindWorker/);
	assert.match(source, /platformHost endpoint must be loopback HTTP root/);
	assert.doesNotMatch(
		source,
		/createExecutionRuntimeProcess|createExecutionRuntime\(/,
	);
	assert.match(
		source,
		/single formal execution-runtime binary owns[\s\S]*?Execution truth/,
	);
});

test("PRESMOKE-B3-BRIDGE-TOPOLOGY-02 Browser adapter credentials are loaded only from owner-private secret files", async (t) => {
	if (process.platform === "win32") return t.skip("POSIX mode proof");
	const root = await mkdtemp(join(tmpdir(), "proflow-browser-composition-security-"));
	const platformToken = join(root, "platform-host.token");
	const bridgeToken = join(root, "bridge.token");
	const configPath = join(root, "browser.json");
	await writeFile(platformToken, "platform-host-token-abcdefghijklmnopqrstuvwxyz012345\n", { mode: 0o600 });
	await writeFile(bridgeToken, "browser-bridge-token-abcdefghijklmnopqrstuvwxyz012345\n", { mode: 0o600 });
	await writeFile(
		configPath,
		JSON.stringify({
			platformHost: { endpoint: "http://127.0.0.1:8787", tokenFile: "platform-host.token" },
			bridge: { extensionId: "abcdefghijklmnopabcdefghijklmnop", tokenFile: "bridge.token" },
		}),
	);

	const config = await loadBrowserExecutorCompositionConfig(configPath);
	assert.match(config.platformHost.token, /^platform-host-token-/);
	assert.match(config.bridge.token, /^browser-bridge-token-/);

	await chmod(bridgeToken, 0o644);
	await assert.rejects(
		loadBrowserExecutorCompositionConfig(configPath),
		/bridge token permissions must be owner-only/,
	);
});

test("PRESMOKE-B3-BRIDGE-TOPOLOGY-03 Browser adapter reports only confirmed DELIVERED and leaves the single Execution Runtime injection to Batch 4", async () => {
	const source = await readFile(sourceUrl, "utf8");
	assert.match(source, /outcome: "DELIVERED"/);
	assert.match(
		source,
		/single formal execution-runtime binary owns[\s\S]*?Execution truth/,
	);
	assert.doesNotMatch(
		source,
		/createExecutionRuntimeProcess|proflow-execution-browser-runtime/,
	);
});

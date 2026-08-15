import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

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

test("PRESMOKE-B3-BRIDGE-TOPOLOGY-02 Browser adapter credentials are loaded from secret files", async () => {
	const source = await readFile(sourceUrl, "utf8");
	assert.match(source, /platformHost\.tokenFile/);
	assert.match(source, /bridge\.tokenFile/);
	assert.doesNotMatch(source, /executionTransportCredentialFile/);
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

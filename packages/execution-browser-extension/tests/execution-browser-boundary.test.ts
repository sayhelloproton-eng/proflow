import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("execution browser facade delegates carrier, primitive and reconciliation flows to isolated owners", async () => {
	const [facade, context, worker, primitive, reconciliation] = await Promise.all([
		read("../src/index.ts"),
		read("../src/execution-browser-context.ts"),
		read("../src/worker-carrier-executor.ts"),
		read("../src/browser-primitive-executor.ts"),
		read("../src/browser-reconciliation.ts"),
	]);

	for (const owner of [
		"createExecutionBrowserContext",
		"executeWorkerCarrier",
		"executeBrowserPrimitive",
		"createBrowserReconciliation",
	])
		assert.match(facade, new RegExp(owner));

	for (const leaked of [
		/WORKER_BIND /,
		/WAKE_REALITY_UNCONFIRMED/,
		/DELIVERY_REALITY_UNCONFIRMED/,
		/browser\.hasMessage/,
		/parseCapturedScreenshot\(shot/,
		/recoveryCompleted/,
	])
		assert.doesNotMatch(facade, leaked);

	assert.match(context, /ensureRestored/);
	assert.match(context, /browserPrecondition/);
	assert.match(worker, /worker\.create/);
	assert.match(worker, /worker\.wake/);
	assert.match(worker, /collaboration\.deliver/);
	assert.match(primitive, /browser\.observe/);
	assert.match(primitive, /browser\.screenshot/);
	assert.match(reconciliation, /state: "NOT_APPLIED"/);
	assert.match(reconciliation, /recoveryScan/);
});

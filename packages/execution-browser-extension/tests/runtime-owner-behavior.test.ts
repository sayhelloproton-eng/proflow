import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { createProvisioningLane } from "../extension/runtime/provisioning-lane.ts";

// MV3 sources use build-time .js imports. Load their actual implementation
// with native type stripping and source URLs; no bundling or copied logic.
async function loadRecoveryController() {
	const url = new URL("../extension/runtime/observer-recovery-controller.ts", import.meta.url);
	const source = (await readFile(url, "utf8")).replace(
		/from "(\.\.?\/[^"\n]+)\.js"/g,
		(_match, path: string) => `from "${new URL(`${path}.ts`, url).href}"`,
	);
	return await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`) as typeof import("../extension/runtime/observer-recovery-controller.ts");
}

test("a pending System assessment never holds subsequent Collaboration recovery", { timeout: 2_000 }, async () => {
	const { createObserverRecoveryController } = await loadRecoveryController();
	let lists = 0;
	let kicks = 0;
	let viewReads = 0;
	const viewEntered = Promise.withResolvers<void>();
	const view = Promise.withResolvers<unknown>();
	const recovery = createObserverRecoveryController({
		storage: { async get() { return {}; }, async set() {} },
		emitDiagnostic() {},
		async invokeObserver(operation) {
			if (operation === "collaboration.listPending") { lists += 1; return []; }
			if (operation === "task.reconcileAll") { kicks += 1; return {}; }
			if (operation === "system.view") { viewReads += 1; viewEntered.resolve(); return view.promise; }
			if (operation === "system.reason") return { ok: false, errorCode: "REASON_UNAVAILABLE" };
			throw new Error(`UNEXPECTED_OPERATION:${operation}`);
		},
	});
	try {
		const first = recovery.requestRecovery();
		await viewEntered.promise;
		await first;
		const reads = viewReads;
		await recovery.requestRecovery();
		assert.equal(lists, 2);
		assert.equal(kicks, 2);
		assert.equal(viewReads, reads, "assessment itself remains single-flight");
	} finally {
		view.resolve({ summary: "test" });
	}
});

async function provisioningDispatch(firstError: Error) {
	let sends = 0;
	let polls = 0;
	let reloads = 0;
	let result: unknown;
	const stop = new Error("STOP_FIXTURE");
	const lane = createProvisioningLane({
		config: async () => ({ endpoint: "http://127.0.0.1:1", token: "test" }),
		getExtensionInstanceId: () => "extension:1", extensionId: "extension",
		async fetchBridge(_config, path, init) {
			if (path.includes("commands/next")) {
				if (polls++ > 0) throw stop;
				return Response.json({ commandId: "command:1", type: "PROVISION_CUSTOM_GPT", request: {} });
			}
			if (path.includes("commands/result")) result = JSON.parse(String(init?.body)) as unknown;
			return Response.json({ accepted: true });
		},
		async sleep() { if (polls > 1) throw stop; },
		openTab: async () => ({ id: 1 }),
		getTab: async () => ({ id: 1, status: "complete", url: "https://chatgpt.com/gpts/editor" }),
		async reloadTab() { reloads += 1; },
		async sendTabMessage() {
			sends += 1;
			if (sends === 1) throw firstError;
			return { ok: true, value: { gptId: "g-created" } };
		},
	});
	await assert.rejects(lane.start(), (error) => error === stop);
	return { sends, reloads, result };
}

test("Provisioning does not replay after the response channel closes", async () => {
	const { sends, reloads, result } = await provisioningDispatch(new Error("The message port closed before a response was received."));
	assert.equal(sends, 1);
	assert.equal(reloads, 0);
	assert.deepEqual(result, { commandId: "command:1", ok: false, error: "PROVISIONING_EFFECT_UNKNOWN" });
});

test("Provisioning can retry a dispatch that never found a receiver", async () => {
	const { sends, reloads, result } = await provisioningDispatch(new Error("Could not establish connection. Receiving end does not exist."));
	assert.equal(sends, 2);
	assert.equal(reloads, 1);
	assert.deepEqual(result, { commandId: "command:1", ok: true, value: { gptId: "g-created" } });
});

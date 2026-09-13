import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { recoverMissingContentReceiver } from "../src/content-session-recovery.ts";
import { createPageRealityRecoveryLoop } from "../extension/runtime/page-reality-watchdog.ts";

test("CP-EXE-BR-45 missing content receiver is injected once and then re-observed", async () => {
	let observes = 0;
	let injections = 0;
	const result = await recoverMissingContentReceiver({
		observe: async () => {
			observes += 1;
			return observes === 1 ? null : { pageState: "BLOCKED" as const };
		},
		inject: async () => {
			injections += 1;
		},
	});
	assert.deepEqual(result, { pageState: "BLOCKED" });
	assert.equal(observes, 2);
	assert.equal(injections, 1);
});

test("CP-EXE-BR-45 healthy content receiver is never injected again", async () => {
	let injections = 0;
	const current = { pageState: "IDLE" as const };
	const result = await recoverMissingContentReceiver({
		observe: async () => current,
		inject: async () => {
			injections += 1;
		},
	});
	assert.equal(result, current);
	assert.equal(injections, 0);
});

test("CP-EXE-BR-45 failed reinjection fails closed without repeated observe", async () => {
	let observes = 0;
	const result = await recoverMissingContentReceiver({
		observe: async () => {
			observes += 1;
			return null;
		},
		inject: async () => {
			throw new Error("SCRIPTING_DENIED");
		},
	});
	assert.equal(result, null);
	assert.equal(observes, 1);
});

test("CP-EXE-BR-45 source wiring injects a missing receiver into current GPT tabs", async () => {
	const [manifest, background, pageReality] = await Promise.all([
		readFile(new URL("../manifest.json", import.meta.url), "utf8"),
		readFile(new URL("../extension/background.ts", import.meta.url), "utf8"),
		readFile(
			new URL("../extension/runtime/page-reality-controller.ts", import.meta.url),
			"utf8",
		),
	]);
	assert.match(manifest, /"scripting"/);
	assert.match(background, /injectContentScript/);
	assert.match(background, /chrome\.scripting\.executeScript/);
	assert.match(background, /dist\/extension\/content\.js/);
	assert.match(pageReality, /recoverMissingContentReceiver/);
	assert.match(pageReality, /PROFLOW_PAGE_SNAPSHOT_REQUEST/);
});

test("CP-EXE-BR-45 recurring recovery dedupes in-flight passes and schedules once", async () => {
	const callbacks: Array<() => void> = [];
	const delays: number[] = [];
	let recoveries = 0;
	let releaseFirst!: () => void;
	const firstRecovery = new Promise<void>((resolve) => {
		releaseFirst = resolve;
	});
	const loop = createPageRealityRecoveryLoop({
		intervalMs: 10_000,
		recover() {
			recoveries += 1;
			return recoveries === 1 ? firstRecovery : Promise.resolve();
		},
		schedule(callback, intervalMs) {
			callbacks.push(callback);
			delays.push(intervalMs);
			return callbacks.length;
		},
	});

	assert.equal(loop.start(), true);
	assert.equal(loop.start(), false);
	assert.deepEqual(delays, [10_000]);
	assert.equal(callbacks.length, 1);

	const first = loop.run();
	const duplicate = loop.run();
	assert.equal(first, duplicate);
	await Promise.resolve();
	assert.equal(recoveries, 1);
	releaseFirst();
	await first;

	callbacks[0]?.();
	await Promise.resolve();
	await Promise.resolve();
	assert.equal(recoveries, 2);
});

test("CP-EXE-BR-45 production background uses the behavior-tested recovery loop", async () => {
	const background = await readFile(
		new URL("../extension/background.ts", import.meta.url),
		"utf8",
	);
	assert.match(background, /createPageRealityRecoveryLoop/);
	assert.match(background, /pageRealityRecovery\.start\(\)/);
	assert.match(background, /pageRealityRecovery\s*\.run\(\)/s);
	assert.doesNotMatch(background, /let pageRecoveryPass:/);
});

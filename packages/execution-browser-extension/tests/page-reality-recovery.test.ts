import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { recoverMissingContentReceiver } from "../src/content-session-recovery.ts";

test("CP-EXE-BR-22 missing content receiver is injected once and then re-observed", async () => {
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

test("CP-EXE-BR-22 healthy content receiver is never injected again", async () => {
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

test("CP-EXE-BR-22 failed reinjection fails closed without repeated observe", async () => {
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

test("CP-EXE-BR-22 background recovery wires scripting reinjection into current GPT tabs", async () => {
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

test("CP-EXE-BR-22 background repeats current-page recovery every ten seconds", async () => {
	const background = await readFile(
		new URL("../extension/background.ts", import.meta.url),
		"utf8",
	);
	assert.match(background, /PAGE_PERMISSION_WATCHDOG_INTERVAL_MS/);
	assert.match(background, /let pageRecoveryPass: Promise<void> \| null = null/);
	assert.match(background, /if \(pageRecoveryPass\) return pageRecoveryPass/);
	assert.match(background, /function startPageRealityWatchdog\(\): void/);
	assert.match(
		background,
		/setInterval\(\(\) => \{\s*void recoverCurrentPageReality\(\)\.catch\(\(\) => undefined\);\s*\}, PAGE_PERMISSION_WATCHDOG_INTERVAL_MS\);/s,
	);
	assert.match(background, /startPageRealityWatchdog\(\)/);
});

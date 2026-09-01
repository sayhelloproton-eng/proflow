import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
	probeChromeExtensionState,
	waitForChromeExtensionEnabled,
} from "../src/chrome-extension-state.ts";

const extensionId = "a".repeat(32);
const loadDir = "/fixture/proflow/execution-browser-extension";

async function fixture(entry?: Record<string, unknown>) {
	const root = await mkdtemp(join(tmpdir(), "proflow-chrome-profile-"));
	const profile = join(root, "Default");
	await mkdir(profile, { recursive: true });
	await writeFile(
		join(profile, "Secure Preferences"),
		JSON.stringify({
			extensions: { settings: entry ? { [extensionId]: entry } : {} },
		}),
	);
	return root;
}
test("Chrome profile probe distinguishes enabled and missing unpacked Extension reality", async (context) => {
	const enabledRoot = await fixture({ location: 4, path: loadDir });
	const missingRoot = await fixture();
	context.after(async () => {
		await Promise.all(
			[enabledRoot, missingRoot].map((root) =>
				rm(root, { recursive: true, force: true }),
			),
		);
	});

	assert.equal(
		await probeChromeExtensionState({
			extensionId,
			loadDir,
			userDataRoot: enabledRoot,
		}),
		"ENABLED",
	);
	assert.equal(
		await probeChromeExtensionState({
			extensionId,
			loadDir,
			userDataRoot: missingRoot,
		}),
		"MISSING",
	);
});

test("Chrome profile probe ignores a matching ID loaded from a different path", async (context) => {
	const root = await fixture({ location: 4, path: "/other/extension" });
	context.after(() => rm(root, { recursive: true, force: true }));
	assert.equal(
		await probeChromeExtensionState({
			extensionId,
			loadDir,
			userDataRoot: root,
		}),
		"MISSING",
	);
});


test("Chrome registration stabilization retries transient missing state until enabled", async () => {
	const observed = ["MISSING", "UNKNOWN", "ENABLED"] as const;
	let index = 0;
	assert.equal(
		await waitForChromeExtensionEnabled(
			{ extensionId, loadDir },
			{
				timeoutMs: 50,
				intervalMs: 1,
				probe: async () =>
					observed[Math.min(index++, observed.length - 1)] ?? "ENABLED",
			},
		),
		"ENABLED",
	);
	assert.equal(index, 3);
});

test("Chrome registration stabilization fails fast for a disabled extension", async () => {
	let calls = 0;
	assert.equal(
		await waitForChromeExtensionEnabled(
			{ extensionId, loadDir },
			{
				timeoutMs: 50,
				intervalMs: 1,
				probe: async () => {
					calls += 1;
					return "DISABLED";
				},
			},
		),
		"DISABLED",
	);
	assert.equal(calls, 1);
});
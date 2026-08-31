import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { probeChromeExtensionState } from "../src/chrome-extension-state.ts";

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
test("Chrome profile probe distinguishes enabled, disabled, and missing unpacked Extension reality", async (context) => {
	const enabledRoot = await fixture({ location: 4, path: loadDir });
	const disabledRoot = await fixture({
		location: 4,
		path: loadDir,
		disable_reasons: [1],
	});
	const missingRoot = await fixture();
	context.after(async () => {
		await Promise.all(
			[enabledRoot, disabledRoot, missingRoot].map((root) =>
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
			userDataRoot: disabledRoot,
		}),
		"DISABLED",
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

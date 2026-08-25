import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { descriptor as chromeDescriptor } from "../../chrome-runtime/deployment/descriptor.ts";

const packagesRoot = new URL("../../../packages/", import.meta.url);

async function text(relative: string) {
	return readFile(new URL(relative, packagesRoot), "utf8");
}

test("browser extension install exposes no manual identity and Chrome runtime owns no Extension load action", async () => {
	const chromeManifest = JSON.parse(
		await text("chrome-runtime/proflow.module.json"),
	) as Record<string, unknown>;
	assert.deepEqual(chromeManifest, chromeDescriptor);

	const platformCli = await text("platform-cli/src/cli.ts");
	const executionSetup = await text("execution-runtime/SETUP.md");
	const extensionSetup = await text("execution-browser-extension/SETUP.md");

	assert.doesNotMatch(platformCli, /--extension-id|Chrome Extension ID/);
	assert.doesNotMatch(
		executionSetup,
		/loaded Chrome Extension ID|Extension ID/,
	);
	assert.doesNotMatch(extensionSetup, /Extension ID|--extension-id/);
	assert.match(extensionSetup, /加载未打包的扩展程序/);
});

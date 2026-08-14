import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";

async function corpus(root: URL): Promise<string> {
	const chunks: string[] = [];
	for (const entry of await readdir(root, { withFileTypes: true })) {
		const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, root);
		if (entry.isDirectory()) chunks.push(await corpus(child));
		else if (entry.isFile() && entry.name.endsWith(".ts"))
			chunks.push(await readFile(child, "utf8"));
	}
	return chunks.join("\n");
}

test("historical universal Task Driver is removed; Observer and Carrier responsibilities stay separated", async () => {
	const text = [
		await corpus(new URL("../src/", import.meta.url)),
		await corpus(new URL("../extension/", import.meta.url)),
	].join("\n");
	assert.doesNotMatch(text, /createExecutionBrowserTaskDriver|class\s+TaskDriver|TASK_NOT_AUTHORIZED_FOR_PROVISIONING/);
	assert.doesNotMatch(text, /taskObserver[^\n]{0,200}\.startNode\s*\(/i);
	assert.doesNotMatch(text, /systemObserver[^\n]{0,200}(?:executeCapability|completeNode|reopenNode|approve)/i);
	assert.match(text, /TaskObserver|taskObserver|TASK_OBSERVER/);
	assert.match(text, /SystemObserver|systemObserver|SYSTEM_OBSERVER/);
	assert.match(text, /CarrierController|carrierController|CARRIER_CONTROLLER/);
});

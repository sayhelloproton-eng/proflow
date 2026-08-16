import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
	runBehaviorConformance,
	runPackageConformance,
	runStaticConformance,
} from "@tomflow/proflow-deployment-conformance";
import type { ModuleDescriptor } from "@tomflow/proflow-module-contract";
import { behaviorAdapter } from "../deployment/adapter.ts";
import { descriptor } from "../deployment/descriptor.ts";

test("Execution Browser module contract C1/C2/C3", async () => {
	const packageRoot = fileURLToPath(new URL("..", import.meta.url));
	const contract = descriptor as unknown as ModuleDescriptor;
	assert.equal(runStaticConformance(descriptor).status, "PASS");
	assert.equal(
		(await runPackageConformance(packageRoot, contract)).status,
		"PASS",
	);
	assert.equal(
		(await runBehaviorConformance(contract, behaviorAdapter)).status,
		"PASS",
	);
	const manifest = JSON.parse(
		await readFile(new URL("../manifest.json", import.meta.url), "utf8"),
	) as {
		background: { service_worker: string };
		content_scripts: Array<{ js: string[] }>;
		side_panel: { default_path: string };
		options_page: string;
	};
	for (const artifact of [
		manifest.background.service_worker,
		...manifest.content_scripts.flatMap((item) => item.js),
		manifest.side_panel.default_path,
		manifest.options_page,
	])
		await access(new URL(`../${artifact}`, import.meta.url));
});

test("PRESMOKE-B6-DESC-01 extension descriptor config surface matches the consumed Bridge/Task/Approval connections", async () => {
	const optionsSource = await readFile(
		new URL("../extension/options.ts", import.meta.url),
		"utf8",
	);
	const slotKeys = (descriptor as unknown as ModuleDescriptor).configSlots.map(
		(slot) => slot.key,
	);
	for (const key of [
		"bridge.endpoint",
		"bridge.token",
		"taskApplication.endpoint",
		"taskApplication.token",
		"approvalApplication.endpoint",
		"approvalApplication.token",
	])
		assert.ok(slotKeys.includes(key), `${key} must be a declared config slot`);
	assert.ok(!slotKeys.includes("executionRuntimeUrl"));
	assert.ok(!slotKeys.includes("localPlatformCredential"));
	for (const storageKey of [
		"proflowRuntimeBridge",
		"proflowTaskApplication",
		"proflowApprovalApplication",
	])
		assert.match(optionsSource, new RegExp(storageKey));
});

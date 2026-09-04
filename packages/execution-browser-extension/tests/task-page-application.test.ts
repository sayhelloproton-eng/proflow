import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const manifestUrl = new URL("../manifest.json", import.meta.url);
const pageUrl = new URL("../extension/tasks.html", import.meta.url);
const sourceUrl = new URL("../extension/tasks.ts", import.meta.url);
const backgroundUrl = new URL("../extension/background.ts", import.meta.url);

test("REAL3 Task UI is an independent extension page opened from the extension action", async () => {
	const manifest = JSON.parse(await readFile(manifestUrl, "utf8")) as {
		permissions?: string[];
		side_panel?: unknown;
		action?: { default_title?: string };
	};
	const html = await readFile(pageUrl, "utf8");
	const source = await readFile(sourceUrl, "utf8");
	const background = await readFile(backgroundUrl, "utf8");
	assert.equal(manifest.side_panel, undefined);
	assert.equal(manifest.permissions?.includes("sidePanel"), false);
	assert.equal(manifest.action?.default_title, "Open ProFlow Tasks");
	assert.match(background, /chrome\.action\.onClicked\.addListener/);
	const mintIndex = background.indexOf("/v1/tasks/session");
	const existingIndex = background.indexOf(
		"const [existing] = await chrome.tabs.query",
	);
	assert.ok(
		mintIndex >= 0 && existingIndex >= 0 && mintIndex < existingIndex,
		"Tasks action must mint a fresh web session before reusing an existing tab",
	);
	assert.match(
		background,
		/chrome\.tabs\.update\(existing\.id,\s*\{\s*url: body\.url,\s*active: true,?\s*\}\)/,
	);
	assert.match(background, /extension\/tasks\.html/);
	assert.match(html, /<title>ProFlow Tasks<\/title>/);
	assert.match(html, /<h1>ProFlow Tasks<\/h1>/);
	for (const control of [
		"New Task + 3 Workers",
		"Confirm / Start",
		"Recover missing Workers",
		"Reopen",
	])
		assert.match(
			`${html}\n${source}`,
			new RegExp(control.replace(/[+]/g, "\\+")),
		);
	for (const operation of [
		"task.create",
		"task.list",
		"task.get",
		"task.start",
		"task.ensureWorkers",
		"node.reopen",
	])
		assert.match(source, new RegExp(operation.replace(".", "\\.")));
	assert.match(html, /Carrier Attention/);
	assert.match(html, /not an Execution Approval fact/);
	assert.match(source, /PROFLOW_CARRIER_ATTENTION_ACTION/);
	assert.match(source, /Allow once/);
	assert.doesNotMatch(source, /Always Allow/);
	assert.match(html, /Approval is an Execution-owned durable fact/);
	assert.match(source, /PROFLOW_APPROVAL_APPLICATION/);
	assert.match(source, /approval\.list/);
	assert.match(source, /approval\.allow/);
	assert.match(source, /approval\.deny/);
	assert.doesNotMatch(
		source,
		/approvalState\s*=|localApproval|approved\s*=\s*true/,
	);
	assert.match(source, /PROFLOW_TASK_APPLICATION/);
	assert.match(source, /\/tasks\/api\/task/);
	assert.match(source, /\/tasks\/api\/approval/);
	assert.match(background, /\/v1\/tasks\/session/);
	assert.match(background, /\/tasks/);
});

test("REAL3 independent Task page does not seed the formal REQUIREMENT document", async () => {
	const html = await readFile(pageUrl, "utf8");
	const source = await readFile(sourceUrl, "utf8");
	assert.doesNotMatch(source, /documentType:\s*"REQUIREMENT"/);
	assert.doesNotMatch(html, /id="task-requirement"/);
	assert.match(source, /initialDocuments:\s*\[\]/);
	assert.match(
		html,
		/Requirement.*clarified by the Product Worker after binding/,
	);
});

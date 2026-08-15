import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("PRESMOKE-B3-UI-01 Side Panel exposes real Task application controls without owning Task or Approval state", async () => {
	const html = await readFile(
		new URL("../extension/side-panel.html", import.meta.url),
		"utf8",
	);
	const source = await readFile(
		new URL("../extension/side-panel.ts", import.meta.url),
		"utf8",
	);
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
	assert.match(html, /Approval is an Execution-owner fact/);
	assert.match(html, /Batch 4 Approval lifecycle/);
	assert.match(html, /<button type="button" disabled>Allow<\/button>/);
	assert.doesNotMatch(source, /authorizeTask|TaskApproval|approvalState\s*=/);
	assert.match(source, /PROFLOW_TASK_APPLICATION/);
});

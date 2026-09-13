import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

function section(source: string, start: string, end: string): string {
	const from = source.indexOf(start);
	assert.notEqual(from, -1, `missing section start: ${start}`);
	const to = source.indexOf(end, from + start.length);
	assert.notEqual(to, -1, `missing section end: ${end}`);
	return source.slice(from, to);
}

test("generic Extension observability omits synthetic side-effect state", async () => {
	const source = await readFile(
		new URL("../extension/runtime/operation-observer.ts", import.meta.url),
		"utf8",
	);

	for (const block of [
		section(source, "\t\trecovery(", "\t\tlifecycle("),
		section(source, "\t\tbrowserCommand(", "\t\tlocalToolSession("),
		section(source, "\t\tpermissionFailure(", "\t\tasync snapshot("),
	])
		assert.doesNotMatch(block, /sideEffectState/);

	assert.match(
		section(source, "\t\tprovisioningCommand(", "\t\tpageTransition("),
		/sideEffectState:\s*outcome\.sideEffectState/,
	);
	assert.match(
		section(source, "\t\tpermission(outcome", "\t\tpermissionFailure("),
		/sideEffectState:\s*outcome\.sideEffectState/,
	);
});

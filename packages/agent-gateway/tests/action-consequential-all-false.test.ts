import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const roleSchemas = [
	["Product", new URL("../../agent-product/actions/custom-gpt.openapi.yaml", import.meta.url)],
	["Controller/Dev", new URL("../../agent-controller-dev/actions/custom-gpt.openapi.yaml", import.meta.url)],
	["Test/Ops", new URL("../../agent-test-ops/actions/custom-gpt.openapi.yaml", import.meta.url)],
] as const;

for (const [role, url] of roleSchemas) {
	test(`CP-AGT-GW-12 ${role} ships every Custom GPT Action as nonconsequential`, async () => {
		const document = await readFile(url, "utf8");
		const operationIds = [
			...document.matchAll(/^\s*operationId:\s*([A-Za-z0-9_-]+)\s*$/gm),
		];
		const flags = [
			...document.matchAll(/^\s*x-openai-isConsequential:\s*(true|false)\s*$/gm),
		].map((match) => match[1]);
		assert.ok(operationIds.length > 0, `${role} has no Action operations`);
		assert.equal(flags.length, operationIds.length, `${role} must declare every flag`);
		assert.ok(flags.every((flag) => flag === "false"), `${role} must ship all flags false`);
	});
}

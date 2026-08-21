import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";

import { moduleDocsDataSchema } from "@tomflow/proflow-module-contract";

const packagesRoot = new URL("../../../packages/", import.meta.url);

test("every built deployment adapter returns its published DOCS.md body", async () => {
	for (const moduleRef of await readdir(packagesRoot)) {
		const packageUrl = new URL(`${moduleRef}/package.json`, packagesRoot);
		let metadata: { proflow?: { module?: boolean } };
		try {
			metadata = JSON.parse(await readFile(packageUrl, "utf8"));
		} catch {
			continue;
		}
		if (metadata.proflow?.module !== true) continue;
		const adapter = (await import(
			new URL(`${moduleRef}/dist/deployment/adapter.js`, packagesRoot).href
		)) as {
			behaviorAdapter: {
				docs(context: { workspaceRoot: string }): Promise<unknown> | unknown;
			};
		};
		const raw = await adapter.behaviorAdapter.docs({
			workspaceRoot: packagesRoot.pathname,
		});
		assert.equal(typeof raw, "object", moduleRef);
		const result = Reflect.get(raw as object, "result");
		const parsed = moduleDocsDataSchema.safeParse(Reflect.get(result, "data"));
		assert.equal(parsed.success, true, moduleRef);
		const expected = await readFile(
			new URL(`${moduleRef}/DOCS.md`, packagesRoot),
			"utf8",
		);
		assert.equal(parsed.success && parsed.data.docs, expected, moduleRef);
		assert.match(expected, /[\u4e00-\u9fff]/, moduleRef);
		assert.doesNotMatch(
			expected,
			/Standard management surface|Public setup inputs|Ownership boundary|Module Docs/,
			moduleRef,
		);
	}
});

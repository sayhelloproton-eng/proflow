import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(
	new URL("../extension/provisioning-content.ts", import.meta.url),
	"utf8",
);

function sliceBetween(startMarker: string, endMarker: string) {
	const start = source.indexOf(startMarker);
	const end = source.indexOf(endMarker, start + startMarker.length);
	assert.ok(start >= 0, `missing start marker: ${startMarker}`);
	assert.ok(end > start, `missing end marker: ${endMarker}`);
	return source.slice(start, end);
}

test("GPT editor action schema targeting is restricted to visible OpenAPI controls", () => {
	const locator = sliceBetween(
		"function actionSchemaControl()",
		"function visibleEditorFailure()",
	);
	assert.match(locator, /available\(label\)/);
	assert.match(locator, /OpenAPI schema/);
	assert.match(locator, /placeholder\*="OpenAPI" i/);
	assert.doesNotMatch(locator, /\["OpenAPI schema", "Schema", "OpenAPI", "架构"\]/);

	const install = sliceBetween(
		"async installActionSchema(value)",
		"async createPrivate()",
	);
	assert.match(install, /let schema = actionSchemaControl\(\)/);
	assert.match(install, /schema = actionSchemaControl\(\)/);
	assert.doesNotMatch(install, /findControl\(/);
});

test("existing GPT action schema updates edit the existing action before any create fallback", () => {
	const install = sliceBetween(
		"async installActionSchema(value)",
		"async createPrivate()",
	);
	assert.match(install, /const edit = existingActionEditButton\(\)/);
	assert.match(install, /if \(edit\) \{/);
	assert.match(install, /await openExistingActionEditor\(\)/);
	assert.ok(
		install.indexOf("await openExistingActionEditor()") <
			install.indexOf('const create = clickable(['),
		"existing Action must be opened before the create-new fallback is considered",
	);
});

test("GPT editor return is idempotent when ChatGPT already returned to Configure", () => {
	const body = sliceBetween(
		"async function returnFromActionEditor()",
		"async function configureBearerAuthDraft",
	);
	assert.match(body, /if \(configureSurfaceReady\(\)\)/);
	assert.match(body, /assertNoVisibleEditorFailure\(\)/);
	assert.match(body, /matchesBoundedSemantic\(button, \["Back", "返回"\]\)/);
	assert.match(body, /GPT_EDITOR_ACTION_BACK_NOT_FOUND/);
});

test("GPT editor provisioning fails closed on visible save and instruction-limit errors", () => {
	assert.match(source, /保存草稿时出错/);
	assert.match(source, /error saving draft/);
	assert.match(source, /gpt 说明不得超过 8000 个字符/);
	assert.match(source, /GPT_EDITOR_VISIBLE_ERROR/);
	assert.match(source, /assertNoVisibleEditorFailure\(\);\n\t\tawait returnFromActionEditor\(\);/);
});

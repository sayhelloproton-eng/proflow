import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const sourceUrl = new URL("../src/index.ts", import.meta.url);

async function source(): Promise<string> {
	return readFile(sourceUrl, "utf8");
}

test("CP-EXE-LOCAL-08 File Bridge materialization is bounded and yields typed artifact metadata", async () => {
	const text = await source();
	for (const token of [
		"EXTERNAL_FILE_MAX_COUNT = 10",
		"EXTERNAL_FILE_MAX_BYTES = 10_000_000",
		"EXTERNAL_FILE_AGGREGATE_MAX_BYTES = 50_000_000",
		"EXTERNAL_FILE_FETCH_TIMEOUT_MS = 15_000",
		"artifactRef",
		"declaredMimeType",
		"detectedMimeType",
		"sha256:",
	]) {
		assert.match(text, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	}
	assert.match(text, /redirect:\s*"manual"/);
	assert.match(text, /localhost|metadata\.google\.internal/);
});

test("CP-EXE-LOCAL-09 locator/fetch failure remains typed transport-materialization failure", async () => {
	const text = await source();
	for (const code of [
		"EXTERNAL_FILE_FETCH_FAILED",
		"EXTERNAL_FILE_FETCH_TIMEOUT",
		"EXTERNAL_FILE_TOO_LARGE",
		"EXTERNAL_FILE_MIME_MISMATCH",
		"CANCELLED",
	]) {
		assert.match(text, new RegExp(code));
	}
	assert.doesNotMatch(text, /(?:completeTask|startNode|waitNode|reopenNode)\s*\(/);
});

test("CP-EXE-LOCAL-10 Context Pack is bounded Artifact mechanics, not a new Store/Service", async () => {
	const text = await source();
	assert.doesNotMatch(text, /class\s+ContextPack(?:Store|Service)|createContextPack(?:Store|Service)/);
	assert.doesNotMatch(text, /context[_-]?pack(?:s)?\s*\([^)]*PRIMARY KEY/i);
	// The implementation that satisfies this proof must expose bounded context-pack
	// mechanics in execution-local without creating a second truth owner.
	assert.match(text, /context[-_ ]?pack/i);
	assert.match(text, /secret|redact/i);
	assert.match(text, /binary|mime|size|bytes/i);
	assert.match(text, /manifest|hash/i);
});

test("CP-EXE-LOCAL-11 Patch proposal materialization is distinct from apply/test Evidence", async () => {
	const text = await source();
	assert.doesNotMatch(text, /class\s+Patch(?:Store|Service)|createPatch(?:Store|Service)/);
	assert.match(text, /patch[-_ ]?proposal/i);
	assert.match(text, /precondition|snapshot|stale/i);
	assert.match(text, /apply/i);
	assert.match(text, /evidence/i);
});

import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	createLocalExecutor,
	materializeContextPack,
	materializePatchProposal,
} from "../src/index.ts";

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
		assert.match(
			text,
			new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
		);
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
	assert.doesNotMatch(
		text,
		/(?:completeTask|startNode|waitNode|reopenNode)\s*\(/,
	);
});

test("CP-EXE-LOCAL-10 Context Pack is bounded Artifact mechanics, not a new Store/Service", async () => {
	const text = await source();
	assert.doesNotMatch(
		text,
		/class\s+ContextPack(?:Store|Service)|createContextPack(?:Store|Service)/,
	);
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
	assert.doesNotMatch(
		text,
		/class\s+Patch(?:Store|Service)|createPatch(?:Store|Service)/,
	);
	assert.match(text, /patch[-_ ]?proposal/i);
	assert.match(text, /precondition|snapshot|stale/i);
	assert.match(text, /apply/i);
	assert.match(text, /evidence/i);
});

test("PRESMOKE-B4-ART-02 Context Pack materialization is bounded, redacted and writes one artifact", async () => {
	const root = await mkdtemp(join(tmpdir(), "proflow-context-pack-"));
	const result = await materializeContextPack({
		artifactRoot: root,
		taskId: "task:1",
		nodeId: "node:1",
		secrets: ["super-secret"],
		entries: [
			{ path: "a.txt", mimeType: "text/plain", content: "hello super-secret" },
			{
				path: "image.bin",
				mimeType: "application/octet-stream",
				content: "ignored",
			},
		],
	});
	assert.equal(result.entries, 1);
	assert.equal(result.binaryFiltered, 1);
	assert.equal(result.redacted, true);
	const id = result.artifactRef.split(":")[1];
	const content = await readFile(join(root, `${id}.context-pack.json`), "utf8");
	assert.doesNotMatch(content, /super-secret/);
});

test("PRESMOKE-B4-ART-03 Patch proposal materializes bytes and base precondition without applying repo effect", async () => {
	const root = await mkdtemp(join(tmpdir(), "proflow-patch-proposal-"));
	const result = await materializePatchProposal({
		artifactRoot: root,
		taskId: "task:1",
		nodeId: "node:1",
		proposal: {
			diff: "--- a/a.txt\n+++ b/a.txt\n@@\n-old\n+new\n",
			baseHash: "sha256:base",
			baseRef: "snapshot:1",
		},
	});
	assert.equal(result.stale, false);
	assert.equal(result.baseHash, "sha256:base");
	assert.equal(result.precondition.baseRef, "snapshot:1");
	assert.ok(result.bytes > 0);
});

test("PRESMOKE-B4-ART-05 Context Pack hash binds redacted content, not only manifest shape", async () => {
	const root = await mkdtemp(join(tmpdir(), "proflow-context-pack-hash-"));
	const first = await materializeContextPack({
		artifactRoot: root,
		taskId: "task:1",
		nodeId: "node:1",
		entries: [{ path: "a.txt", mimeType: "text/plain", content: "alpha" }],
	});
	const second = await materializeContextPack({
		artifactRoot: root,
		taskId: "task:1",
		nodeId: "node:1",
		entries: [{ path: "a.txt", mimeType: "text/plain", content: "bravo" }],
	});
	assert.notEqual(first.hash, second.hash);
});

test("PRESMOKE-B4-ART-06 patch.apply validates durable Artifact bytes, applies separately, and reconciles APPLIED", async () => {
	const root = await mkdtemp(join(tmpdir(), "proflow-patch-apply-"));
	await writeFile(join(root, "package.json"), '{"name":"fixture"}\n', "utf8");
	await writeFile(join(root, "a.txt"), "old\n", "utf8");
	const { spawnSync } = await import("node:child_process");
	for (const args of [
		["init"],
		["config", "user.email", "test@example.com"],
		["config", "user.name", "Test"],
		["add", "."],
		["commit", "-m", "init"],
	]) {
		const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
		assert.equal(result.status, 0, result.stderr);
	}
	const artifactRoot = join(root, ".artifact-store");
	const proposal = await materializePatchProposal({
		artifactRoot,
		taskId: "task:1",
		nodeId: "node:1",
		proposal: {
			diff: "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n",
			baseHash: "sha256:base",
			baseRef: "snapshot:1",
		},
	});
	const artifactId = proposal.artifactRef.split(":")[1];
	const patchPath = join(artifactRoot, `${artifactId}.patch-proposal.diff`);
	const executor = await createLocalExecutor({
		projectRoot: root,
		artifactRoot,
		resolvePatchArtifact: async (artifactRef) =>
			artifactRef === proposal.artifactRef
				? {
						artifactRef,
						kind: "patch-proposal",
						path: patchPath,
						hash: proposal.hash,
						baseHash: proposal.baseHash,
						baseRef: proposal.precondition.baseRef,
					}
				: undefined,
	});
	let precondition: unknown;
	const request = {
		contract: "execution",
		contractVersion: "1.0.0",
		callerRef: "role:test",
		capability: "patch.apply",
		input: { artifactRef: proposal.artifactRef },
		projectRoot: root,
		idempotencyKey: "patch:1",
		correlationId: "patch:1",
	} as const;
	const applied = await executor.execute({
		request,
		admission: { policy: "ALLOW", decisionPath: "human", approval: "VALID" },
		onEffectStarted: (value) => {
			precondition = value;
		},
	});
	assert.equal(applied.successful, true);
	assert.equal(await readFile(join(root, "a.txt"), "utf8"), "new\n");
	assert.ok(precondition);
	const reconciled = await executor.reconcile(request, precondition as never);
	assert.equal(reconciled.state, "APPLIED");
});

test("PRESMOKE-B4-ART-09 quality.test failure is a known verification outcome, not an UNKNOWN repo effect", async () => {
	const root = await mkdtemp(join(tmpdir(), "proflow-quality-known-failure-"));
	await writeFile(
		join(root, "package.json"),
		JSON.stringify({ name: "fixture", scripts: { test: "node fail.cjs" } }),
		"utf8",
	);
	await writeFile(join(root, "fail.cjs"), "process.exit(7);\n", "utf8");
	const executor = await createLocalExecutor({
		projectRoot: root,
		artifactRoot: join(root, ".artifacts"),
	});
	let effectStarts = 0;
	const result = await executor.execute({
		request: {
			contract: "execution",
			contractVersion: "1.0.0",
			callerRef: "role:test",
			capability: "quality.test",
			input: {},
			projectRoot: root,
			idempotencyKey: "quality:fail",
		},
		admission: {
			policy: "ALLOW",
			decisionPath: "fast",
			approval: "NOT_REQUIRED",
		},
		onEffectStarted: () => {
			effectStarts += 1;
		},
	});
	assert.equal(result.successful, false);
	assert.equal(result.effectApplied, false);
	assert.equal(result.result.capability, "quality.test");
	assert.equal(result.result.data.exitCode, 7);
	assert.equal(effectStarts, 0);
});

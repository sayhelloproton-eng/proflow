import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { agentMaterialPackages, agentMaterialSource, agentMaterialReleaseErrors, recordReleasedAgentMaterials } from "../agent-material-release-guard.mjs";

test("Agent deployable material drift requires per-package intent; surface write cannot acknowledge a new baseline", async (context) => {
	const root = await mkdtemp(resolve(tmpdir(), "agent-material-release-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(resolve(root, ".changeset"));
	const baseline = {};
	for (const dir of agentMaterialPackages) {
		await mkdir(resolve(root, "packages", dir, "actions"), { recursive: true });
		await writeFile(resolve(root, "packages", dir, "package.json"), JSON.stringify({ name: `@tomflow/proflow-${dir}`, version: "1.0.0", description: dir, proflowAgent: { instructions: "original" } }));
		await writeFile(resolve(root, "packages", dir, "actions/schema.yaml"), "old");
		baseline[dir] = await agentMaterialSource(root, dir);
	}
	await writeFile(resolve(root, ".changeset/agent-material-baseline.json"), JSON.stringify(baseline));
	assert.deepEqual(await agentMaterialReleaseErrors(root), []);
	for (const dir of agentMaterialPackages) await writeFile(resolve(root, "packages", dir, "actions/schema.yaml"), "new");
	assert.equal((await agentMaterialReleaseErrors(root)).length, 3);
	await writeFile(resolve(root, ".changeset/intent.md"), '---\n"@tomflow/proflow-agent-controller-dev": patch\n---\nRelease Dev\n');
	assert.equal((await agentMaterialReleaseErrors(root)).length, 2);
	assert.equal((await agentMaterialReleaseErrors(root, { selectedDirs: ["agent-controller-dev"], requireReleased: true })).length, 1);
	await writeFile(resolve(root, ".changeset/ledger.yaml"), '"@tomflow/proflow-agent-controller-dev@1.0.0":\n  dir: packages/agent-controller-dev\n');
	await assert.rejects(recordReleasedAgentMaterials(root, ["agent-controller-dev"]), /VERSION_NOT_ADVANCED/);
	const path = resolve(root, "packages/agent-controller-dev/package.json");
	const manifest = JSON.parse(await readFile(path, "utf8"));
	manifest.version = "1.0.1";
	await writeFile(path, JSON.stringify(manifest));
	await assert.rejects(recordReleasedAgentMaterials(root, ["agent-controller-dev"]), /LEDGER_MISSING/);
	await writeFile(resolve(root, ".changeset/ledger.yaml"), '"@tomflow/proflow-agent-controller-dev@1.0.1":\n  dir: packages/agent-controller-dev\n');
	await recordReleasedAgentMaterials(root, ["agent-controller-dev"]);
	await rm(resolve(root, ".changeset/intent.md"));
	assert.equal((await agentMaterialReleaseErrors(root)).length, 2);
});

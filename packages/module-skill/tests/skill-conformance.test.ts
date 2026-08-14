import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type TestContext, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
	type ConformanceGateResult,
	runGeneratedPackageConformance,
} from "@tomflow/proflow-deployment-conformance";
import { materializeModule } from "@tomflow/proflow-module-template";

const execFileAsync = promisify(execFile);
const tsc = resolve(
	import.meta.dirname,
	"../../../node_modules/typescript/bin/tsc",
);

type FlowDecision = "PROCEED" | "STOP_CONFORMANCE_FAILED";

function flowDecision(gates: readonly ConformanceGateResult[]): FlowDecision {
	return gates.some((gate) => gate.status === "FAIL")
		? "STOP_CONFORMANCE_FAILED"
		: "PROCEED";
}

async function buildFixture(packageDirectory: string): Promise<void> {
	await execFileAsync(process.execPath, [
		tsc,
		"-p",
		join(packageDirectory, "tsconfig.build.json"),
	]);
}

test("module-skill itself passes C1/C2/C3 generated-package conformance", async () => {
	const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
	await buildFixture(packageDirectory);
	assert.deepEqual(
		(await runGeneratedPackageConformance(packageDirectory)).map(
			(gate) => gate.status,
		),
		["PASS", "PASS", "PASS"],
	);
});

test("CP-DPL-SKILL-04 a well-formed fixture conforms; a corrupted artifact stops the flow", async (context: TestContext) => {
	const root = await mkdtemp(join(tmpdir(), "proflow-skill-flow-"));
	context.after(() => rm(root, { recursive: true, force: true }));

	const good = await materializeModule({
		targetDirectory: root,
		moduleRef: "skill-fixture-good",
		packageName: "@tomflow/proflow-skill-fixture-good",
		kind: "library",
	});
	await buildFixture(good.packageDirectory);
	const goodGates = await runGeneratedPackageConformance(good.packageDirectory);
	assert.deepEqual(
		goodGates.map((gate) => gate.status),
		["PASS", "PASS", "PASS"],
	);
	assert.equal(flowDecision(goodGates), "PROCEED");

	const c1Broken = await materializeModule({
		targetDirectory: root,
		moduleRef: "skill-fixture-c1",
		packageName: "@tomflow/proflow-skill-fixture-c1",
		kind: "library",
	});
	await writeFile(
		join(c1Broken.packageDirectory, "deployment/descriptor.ts"),
		'export const descriptor = { contract: "module", contractVersion: "1.0.0", moduleRef: "skill-fixture-c1", packageName: "@tomflow/proflow-skill-fixture-c1", moduleVersion: "0.1.0", kind: "service", templateVersion: "1.0.0", platformCompatibility: ">=1.0.0 <2.0.0", provides: [], requires: [], requirements: [{ kind: "runtime", runtime: "node", versionRange: ">=24.19.0" }], configSlots: [], lifecycle: { supported: ["verify"] }, verification: { checks: [{ id: "c1-check", description: "check", lifecycle: "verify" }] }, effects: [] } as const;\n',
	);
	const c1Gates = await runGeneratedPackageConformance(
		c1Broken.packageDirectory,
	);
	assert.equal(c1Gates[0]?.status, "FAIL");
	assert.equal(flowDecision(c1Gates), "STOP_CONFORMANCE_FAILED");

	const c2Broken = await materializeModule({
		targetDirectory: root,
		moduleRef: "skill-fixture-c2",
		packageName: "@tomflow/proflow-skill-fixture-c2",
		kind: "library",
	});
	await buildFixture(c2Broken.packageDirectory);
	await rm(join(c2Broken.packageDirectory, "conformance.json"));
	const c2Gates = await runGeneratedPackageConformance(
		c2Broken.packageDirectory,
	);
	assert.equal(c2Gates[1]?.status, "FAIL");
	assert.equal(flowDecision(c2Gates), "STOP_CONFORMANCE_FAILED");

	const c3Broken = await materializeModule({
		targetDirectory: root,
		moduleRef: "skill-fixture-c3",
		packageName: "@tomflow/proflow-skill-fixture-c3",
		kind: "library",
	});
	await buildFixture(c3Broken.packageDirectory);
	await writeFile(
		join(c3Broken.packageDirectory, "deployment/adapter.ts"),
		"export const behaviorAdapter = {};\n",
	);
	const c3Gates = await runGeneratedPackageConformance(
		c3Broken.packageDirectory,
	);
	assert.equal(c3Gates[2]?.status, "FAIL");
	assert.equal(flowDecision(c3Gates), "STOP_CONFORMANCE_FAILED");
});

test("RF-DPL-SKILL-04 a modified artifact that skips re-conformance is rejected by a real gate", async (context: TestContext) => {
	const root = await mkdtemp(join(tmpdir(), "proflow-skill-reconform-"));
	context.after(() => rm(root, { recursive: true, force: true }));

	const fixture = await materializeModule({
		targetDirectory: root,
		moduleRef: "skill-fixture-reconform",
		packageName: "@tomflow/proflow-skill-fixture-reconform",
		kind: "library",
	});
	await buildFixture(fixture.packageDirectory);

	const before = await runGeneratedPackageConformance(fixture.packageDirectory);
	assert.equal(flowDecision(before), "PROCEED");

	await writeFile(
		join(fixture.packageDirectory, "deployment/adapter.ts"),
		"export const behaviorAdapter = {};\n",
	);
	const after = await runGeneratedPackageConformance(fixture.packageDirectory);
	assert.equal(after[2]?.status, "FAIL");
	assert.equal(flowDecision(after), "STOP_CONFORMANCE_FAILED");
});

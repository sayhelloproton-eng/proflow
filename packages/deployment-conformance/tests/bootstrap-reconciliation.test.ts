import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import {
	type ModuleDescriptor,
	parseModuleDescriptor,
} from "@tomflow/proflow-module-contract";
import { materializeModule } from "@tomflow/proflow-module-template";
import { descriptor as contractDescriptorInput } from "../../module-contract/deployment/descriptor.ts";
import { descriptor as templateDescriptorInput } from "../../module-template/deployment/descriptor.ts";
import { descriptor as conformanceDescriptorInput } from "../deployment/descriptor.ts";
import {
	type BehaviorAdapter,
	type BehaviorObservation,
	runBehaviorConformance,
	runPackageConformance,
	runStaticConformance,
} from "../src/index.ts";

const execFileAsync = promisify(execFile);

function behaviorAdapter(descriptor: ModuleDescriptor): BehaviorAdapter {
	const adapter: BehaviorAdapter = {};
	for (const primitive of descriptor.lifecycle.supported) {
		adapter[primitive] = (): BehaviorObservation => ({
			result: {
				contract: "deployment.result.v1",
				ok: true,
				status: "SUCCEEDED",
				moduleRef: descriptor.moduleRef,
				moduleVersion: descriptor.moduleVersion,
				checks: [
					{ id: "bootstrap-check", status: "PASS", message: "observed" },
				],
			},
			observedEffects: [],
			...(descriptor.kind === "external-resource" && primitive === "status"
				? {
						externalAvailabilityClaim: "UNKNOWN",
						externalAvailabilityEvidence: "fake",
						readinessClaim: "UNKNOWN",
						readinessEvidence: "fake",
					}
				: {}),
		});
	}
	return adapter;
}

test("Bootstrap closure generates, typechecks, validates, and conforms all six profiles", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "proflow-bootstrap-closure-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	const tsc = resolve(
		import.meta.dirname,
		"../../../node_modules/typescript/bin/tsc",
	);
	const kinds: ModuleDescriptor["kind"][] = [
		"library",
		"service",
		"cli",
		"browser-extension",
		"agent-package",
		"external-resource",
	];
	for (const kind of kinds) {
		const moduleRef = `bootstrap-${kind}`;
		const generated = await materializeModule({
			targetDirectory: root,
			moduleRef,
			packageName: `@tomflow/${moduleRef}`,
			kind,
		});
		const descriptor = parseModuleDescriptor(generated.descriptor);
		assert.equal(runStaticConformance(descriptor).status, "PASS");
		assert.equal(
			(await runPackageConformance(generated.packageDirectory, descriptor))
				.status,
			"PASS",
		);
		assert.equal(
			(await runBehaviorConformance(descriptor, behaviorAdapter(descriptor)))
				.status,
			"PASS",
		);
		await execFileAsync(process.execPath, [
			tsc,
			"--noEmit",
			"-p",
			generated.packageDirectory,
		]);
	}
});

test("Bootstrap closure deterministically rejects intentional C1, C2, and C3 breakage", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "proflow-bootstrap-broken-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	const generated = await materializeModule({
		targetDirectory: root,
		moduleRef: "bootstrap-broken",
		packageName: "@tomflow/bootstrap-broken",
		kind: "service",
	});
	assert.equal(
		runStaticConformance({ ...generated.descriptor, contractVersion: "2.0.0" })
			.status,
		"FAIL",
	);

	const packagePath = join(generated.packageDirectory, "package.json");
	const metadata = JSON.parse(await readFile(packagePath, "utf8")) as Record<
		string,
		unknown
	>;
	await writeFile(
		packagePath,
		`${JSON.stringify({ ...metadata, version: "8.8.8" }, null, 2)}\n`,
	);
	assert.equal(
		(
			await runPackageConformance(
				generated.packageDirectory,
				generated.descriptor,
			)
		).status,
		"FAIL",
	);

	const adapter = behaviorAdapter(generated.descriptor);
	adapter.preflight = () => ({
		result: {
			contract: "deployment.result.v1",
			ok: true,
			status: "SUCCEEDED",
			moduleRef: generated.descriptor.moduleRef,
			moduleVersion: generated.descriptor.moduleVersion,
		},
		observedEffects: ["started process"],
	});
	assert.equal(
		(await runBehaviorConformance(generated.descriptor, adapter)).status,
		"FAIL",
	);
});

test("Bootstrap packages reconcile with their own Module Contract and Package gates", async () => {
	const repositoryRoot = resolve(import.meta.dirname, "../../..");
	const packages: Array<[string, ModuleDescriptor]> = [
		["module-contract", parseModuleDescriptor(contractDescriptorInput)],
		["module-template", parseModuleDescriptor(templateDescriptorInput)],
		[
			"deployment-conformance",
			parseModuleDescriptor(conformanceDescriptorInput),
		],
	];
	for (const [directory, descriptor] of packages) {
		assert.equal(runStaticConformance(descriptor).status, "PASS");
		assert.equal(
			(
				await runPackageConformance(
					join(repositoryRoot, "packages", directory),
					descriptor,
				)
			).status,
			"PASS",
		);
		assert.equal(
			(await runBehaviorConformance(descriptor, behaviorAdapter(descriptor)))
				.status,
			"PASS",
		);
	}
});

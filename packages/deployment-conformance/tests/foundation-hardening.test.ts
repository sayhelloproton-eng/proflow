import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { materializeModule } from "@tomflow/proflow-module-template";
import {
	runGeneratedPackageConformance,
	runPackageConformance,
	runStaticConformance,
} from "../src/index.ts";

test("P1-1..P1-5 generated package own adapters pass C1/C2/C3 and break at the owning gate", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "proflow-foundation-hardening-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	for (const kind of [
		"library",
		"service",
		"cli",
		"browser-extension",
		"agent-package",
		"external-resource",
	] as const) {
		const generated = await materializeModule({
			targetDirectory: root,
			moduleRef: `closure-${kind}`,
			packageName: `@tomflow/proflow-closure-${kind}`,
			kind,
		});
		const result = await runGeneratedPackageConformance(
			generated.packageDirectory,
		);
		assert.deepEqual(
			result.map((item) => item.status),
			["PASS", "PASS", "PASS"],
		);
	}

	const c1 = await materializeModule({
		targetDirectory: root,
		moduleRef: "broken-c1",
		packageName: "@tomflow/proflow-broken-c1",
		kind: "library",
	});
	assert.equal(
		runStaticConformance({ ...c1.descriptor, packageName: "@tomflow/broken" })
			.status,
		"FAIL",
	);

	const c2 = await materializeModule({
		targetDirectory: root,
		moduleRef: "broken-c2",
		packageName: "@tomflow/proflow-broken-c2",
		kind: "library",
	});
	const packagePath = join(c2.packageDirectory, "package.json");
	const metadata = JSON.parse(await readFile(packagePath, "utf8")) as Record<
		string,
		unknown
	>;
	await writeFile(
		packagePath,
		`${JSON.stringify({ ...metadata, private: true }, null, 2)}\n`,
	);
	assert.equal(
		(await runPackageConformance(c2.packageDirectory, c2.descriptor)).status,
		"FAIL",
	);

	const c3 = await materializeModule({
		targetDirectory: root,
		moduleRef: "broken-c3",
		packageName: "@tomflow/proflow-broken-c3",
		kind: "service",
	});
	await writeFile(
		join(c3.packageDirectory, "deployment/adapter.ts"),
		"export const behaviorAdapter = {};\n",
	);
	assert.equal(
		(await runGeneratedPackageConformance(c3.packageDirectory))[2]?.status,
		"FAIL",
	);
});

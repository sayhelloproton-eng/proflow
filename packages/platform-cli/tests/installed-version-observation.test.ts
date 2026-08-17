import assert from "node:assert/strict";
import {
	mkdir,
	mkdtemp,
	readFile,
	symlink,
	unlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createWorkspacePackageManagerDriver } from "../src/apply/driver.ts";
import type { ResolvedModule } from "../src/contracts.ts";

const packageName = "@tomflow/proflow-observer-fixture";

function moduleFixture(): ResolvedModule {
	return {
		moduleRef: "observer-fixture",
		packageName,
		moduleVersion: "0.1.1",
		kind: "registry-package",
		installClass: "core",
		documentation: [],
		provides: [],
		requires: [],
		requirements: [],
		configSlots: [],
		lifecycle: [],
		verification: {
			checks: [
				{
					id: "fixture",
					description: "fixture",
					lifecycle: "verify",
				},
			],
		},
		effects: [],
		source: { type: "registry" },
	};
}

async function writeFixturePackage(
	root: string,
	directory: string,
	version: string,
): Promise<string> {
	const packageRoot = join(root, ".store", directory);
	await mkdir(packageRoot, { recursive: true });
	await writeFile(
		join(packageRoot, "package.json"),
		`${JSON.stringify(
			{
				name: packageName,
				version,
				type: "module",
				main: "index.js",
			},
			null,
			2,
		)}\n`,
	);
	await writeFile(join(packageRoot, "index.js"), "export default true;\n");
	return packageRoot;
}

test("installed-version observation follows the current node_modules package after a symlink upgrade", async () => {
	const workspace = await mkdtemp(join(tmpdir(), "proflow-installed-version-"));
	await mkdir(join(workspace, "node_modules", "@tomflow"), { recursive: true });

	const v010 = await writeFixturePackage(workspace, "v010", "0.1.0");
	const v011 = await writeFixturePackage(workspace, "v011", "0.1.1");
	const packageLink = join(
		workspace,
		"node_modules",
		"@tomflow",
		"proflow-observer-fixture",
	);

	await writeFile(
		join(workspace, "package.json"),
		`${JSON.stringify(
			{
				private: true,
				packageManager: "pnpm@11.21.0",
				dependencies: { [packageName]: "0.1.0" },
			},
			null,
			2,
		)}\n`,
	);
	await symlink(v010, packageLink);

	const driver = createWorkspacePackageManagerDriver({
		workspaceRoot: workspace,
		runner: {
			async run() {
				throw new Error("runner must not be called by observation");
			},
		},
	});

	assert.equal(await driver.observeInstalledVersion(moduleFixture()), "0.1.0");

	await unlink(packageLink);
	await symlink(v011, packageLink);

	const manifest = JSON.parse(
		await readFile(join(workspace, "package.json"), "utf8"),
	) as {
		dependencies: Record<string, string>;
	};
	manifest.dependencies[packageName] = "0.1.1";
	await writeFile(
		join(workspace, "package.json"),
		`${JSON.stringify(manifest, null, 2)}\n`,
	);

	assert.equal(await driver.observeInstalledVersion(moduleFixture()), "0.1.1");
});

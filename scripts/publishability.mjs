import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packagesRoot = join(repositoryRoot, "packages");
const temporaryRoot = mkdtempSync(join(tmpdir(), "proflow-publishability-"));
const tarballRoot = join(temporaryRoot, "tarballs");
const consumerRoot = join(temporaryRoot, "consumer");

try {
	mkdirSync(tarballRoot, { recursive: true });
	mkdirSync(consumerRoot, { recursive: true });
	const packageDirectories = readdirSync(packagesRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => join(packagesRoot, entry.name))
		.sort();
	const packageNames = packageDirectories.map((directory) => {
		const metadata = JSON.parse(
			readFileSync(join(directory, "package.json"), "utf8"),
		);
		if (
			metadata.private === true ||
			metadata.publishConfig?.access !== "public"
		)
			throw new Error(`${directory} is not a publishable public package`);
		return metadata.name;
	});
	for (const directory of packageDirectories) {
		execFileSync(
			"pnpm",
			["--dir", directory, "pack", "--pack-destination", tarballRoot],
			{
				cwd: repositoryRoot,
				stdio: "pipe",
			},
		);
	}
	const zodDirectory = resolve(
		packagesRoot,
		"module-contract/node_modules/zod",
	);
	execFileSync(
		"pnpm",
		["--dir", zodDirectory, "pack", "--pack-destination", tarballRoot],
		{
			cwd: repositoryRoot,
			stdio: "pipe",
		},
	);
	writeFileSync(
		join(consumerRoot, "package.json"),
		`${JSON.stringify({ name: "proflow-isolated-consumer", private: true, type: "module" }, null, 2)}\n`,
	);
	const tarballs = readdirSync(tarballRoot)
		.filter((file) => file.endsWith(".tgz"))
		.map((file) => join(tarballRoot, file));
	execFileSync(
		"npm",
		[
			"install",
			"--ignore-scripts",
			"--no-audit",
			"--no-fund",
			"--no-package-lock",
			...tarballs,
		],
		{ cwd: consumerRoot, stdio: "pipe" },
	);
	writeFileSync(
		join(consumerRoot, "smoke.mjs"),
		`${packageNames.map((name) => `await import(${JSON.stringify(name)});`).join("\n")}\n`,
	);
	execFileSync(process.execPath, ["smoke.mjs"], {
		cwd: consumerRoot,
		stdio: "pipe",
	});
	process.stdout.write(
		`Publishability PASS: ${packageNames.length} package tarballs installed and imported by an isolated consumer (${tarballs.map((file) => basename(file)).join(", ")})\n`,
	);
} finally {
	rmSync(temporaryRoot, { recursive: true, force: true });
}

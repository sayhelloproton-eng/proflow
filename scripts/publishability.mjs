import { execFileSync, spawnSync } from "node:child_process";
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
import { listWorkspacePackages, resolveRequestedPackages } from "./package-selection.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packagesRoot = join(repositoryRoot, "packages");
const temporaryRoot = mkdtempSync(join(tmpdir(), "proflow-publishability-"));
const tarballRoot = join(temporaryRoot, "tarballs");
const consumerRoot = join(temporaryRoot, "consumer");
const requested = process.argv.slice(2);
const selectedPackages = requested.length === 0
	? listWorkspacePackages()
	: resolveRequestedPackages(requested, "Usage: node scripts/publishability.mjs [package-dir|package-name ...]");

try {
	mkdirSync(tarballRoot, { recursive: true });
	mkdirSync(consumerRoot, { recursive: true });
	const packageDirectories = selectedPackages.map((pkg) => pkg.directory);
	const packageMetadata = selectedPackages.map((pkg) => {
		const directory = pkg.directory;
		const metadata = pkg.manifest;
		if (
			metadata.private === true ||
			metadata.publishConfig?.access !== "public"
		)
			throw new Error(`${directory} is not a publishable public package`);
		return metadata;
	});
	const packageNames = packageMetadata.map((metadata) => metadata.name);
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
		`${packageMetadata
			.flatMap((metadata) =>
				Object.entries(metadata.exports ?? {})
					.filter(
						([, target]) =>
							typeof target === "string" && target.endsWith(".js"),
					)
					.map(([subpath]) =>
						subpath === "."
							? metadata.name
							: `${metadata.name}/${subpath.slice(2)}`,
					),
			)
			.map((specifier) => `await import(${JSON.stringify(specifier)});`)
			.join("\n")}\n`,
	);
	execFileSync(process.execPath, ["smoke.mjs"], {
		cwd: consumerRoot,
		stdio: "pipe",
	});
	const binaryNames = packageMetadata.flatMap((metadata) =>
		typeof metadata.bin === "string"
			? [metadata.name.split("/").at(-1)]
			: Object.keys(metadata.bin ?? {}),
	);
	for (const binaryName of binaryNames) {
		if (!binaryName) continue;
		const executable = join(consumerRoot, "node_modules", ".bin", binaryName);
		const result = spawnSync(executable, ["--help"], {
			cwd: consumerRoot,
			encoding: "utf8",
			timeout: 10_000,
		});
		if (
			result.error ||
			result.signal ||
			(result.status !== 0 && result.status !== 1) ||
			/module not found|ERR_MODULE_NOT_FOUND/i.test(
				`${result.stdout ?? ""}\n${result.stderr ?? ""}`,
			)
		)
			throw new Error(`published binary smoke failed: ${binaryName}`);
	}
	process.stdout.write(
		`Publishability PASS: ${packageNames.length} package tarballs, all public JS exports, and ${binaryNames.length} binaries consumed from isolated installs (${tarballs.map((file) => basename(file)).join(", ")})\n`,
	);
} finally {
	rmSync(temporaryRoot, { recursive: true, force: true });
}

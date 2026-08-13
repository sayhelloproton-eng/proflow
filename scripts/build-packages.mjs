import { execFileSync } from "node:child_process";
import {
	cpSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packagesRoot = join(repositoryRoot, "packages");
const temporaryRoot = mkdtempSync(join(tmpdir(), "proflow-build-"));

try {
	execFileSync(
		"pnpm",
		["exec", "tsc", "-p", "tsconfig.build.json", "--outDir", temporaryRoot],
		{ cwd: repositoryRoot, stdio: "inherit" },
	);
	for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const destination = join(packagesRoot, entry.name, "dist");
		rmSync(destination, { recursive: true, force: true });
		cpSync(join(temporaryRoot, "packages", entry.name), destination, {
			recursive: true,
		});
	}

	// MV3 content scripts are loaded as classic scripts (no `type: module`), so
	// they must not contain ES module syntax. The monorepo compiles under
	// `module: NodeNext`, which appends an `export {};` marker to files that have
	// no imports/exports; strip it so the content script runs as a classic script.
	const contentScript = join(
		packagesRoot,
		"execution-browser-extension",
		"dist",
		"extension",
		"content.js",
	);
	writeFileSync(
		contentScript,
		readFileSync(contentScript, "utf8")
			.split("\n")
			.filter((line) => line.trim() !== "export {};")
			.join("\n"),
	);
} finally {
	rmSync(temporaryRoot, { recursive: true, force: true });
}

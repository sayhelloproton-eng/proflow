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
import {
	listWorkspacePackages,
	resolveRequestedPackages,
} from "./package-selection.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packagesRoot = join(repositoryRoot, "packages");
const temporaryRoot = mkdtempSync(join(tmpdir(), "proflow-build-"));
const requested = process.argv.slice(2);
const selectedPackages =
	requested.length === 0
		? listWorkspacePackages()
		: resolveRequestedPackages(
				requested,
				"Usage: node scripts/build-packages.mjs [package-dir|package-name ...]",
			);
const selectedNames = new Set(selectedPackages.map((pkg) => pkg.dirName));

try {
	execFileSync(
		"pnpm",
		["exec", "tsc", "-p", "tsconfig.build.json", "--outDir", temporaryRoot],
		{ cwd: repositoryRoot, stdio: "inherit" },
	);
	for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
		if (!entry.isDirectory() || !selectedNames.has(entry.name)) continue;
		const destination = join(packagesRoot, entry.name, "dist");
		rmSync(destination, { recursive: true, force: true });
		cpSync(join(temporaryRoot, "packages", entry.name), destination, {
			recursive: true,
		});
	}

	if (selectedNames.has("execution-browser-extension")) {
		// The MV3 background service worker must be a browser-self-contained ESM
		// bundle. Plain `tsc` output preserves workspace package imports and Node
		// builtins, which a real Chrome extension service worker cannot resolve.
		const browserBackground = join(
			packagesRoot,
			"execution-browser-extension",
			"dist",
			"extension",
			"background.js",
		);
		execFileSync(
			"pnpm",
			[
				"exec",
				"esbuild",
				"packages/execution-browser-extension/extension/background.ts",
				"--bundle",
				"--platform=browser",
				"--format=esm",
				"--target=chrome120",
				"--tsconfig=tsconfig.build.json",
				`--outfile=${browserBackground}`,
				"--log-level=warning",
			],
			{ cwd: repositoryRoot, stdio: "inherit" },
		);

		const backgroundBundle = readFileSync(browserBackground, "utf8");
		const unresolvedModuleImport =
			/(?:^|\n)\s*(?:import|export)\s+(?:[^"'\n]*?\sfrom\s*)?["']([^"']+)["']/g;
		const dynamicModuleImport = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
		const residualImports = [
			...backgroundBundle.matchAll(unresolvedModuleImport),
			...backgroundBundle.matchAll(dynamicModuleImport),
		].map((match) => match[1]);
		if (residualImports.length > 0) {
			throw new Error(
				`browser background bundle is not self-contained: ${residualImports.join(", ")}`,
			);
		}

		// GPT provisioning is also a manifest content script, but it imports the
		// shared editor driver. Bundle it as a classic IIFE so Chrome never sees ESM.
		const provisioningContent = join(
			packagesRoot,
			"execution-browser-extension",
			"dist",
			"extension",
			"provisioning-content.js",
		);
		execFileSync(
			"pnpm",
			[
				"exec",
				"esbuild",
				"packages/execution-browser-extension/extension/provisioning-content.ts",
				"--bundle",
				"--platform=browser",
				"--format=iife",
				"--target=chrome120",
				"--tsconfig=tsconfig.build.json",
				`--outfile=${provisioningContent}`,
				"--log-level=warning",
			],
			{ cwd: repositoryRoot, stdio: "inherit" },
		);
		const provisioningBundle = readFileSync(provisioningContent, "utf8");
		if (/(?:^|\n)\s*(?:import|export)\s/m.test(provisioningBundle)) {
			throw new Error(
				"browser provisioning content bundle contains ESM syntax",
			);
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
	}
} finally {
	rmSync(temporaryRoot, { recursive: true, force: true });
}

import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
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
} finally {
	rmSync(temporaryRoot, { recursive: true, force: true });
}

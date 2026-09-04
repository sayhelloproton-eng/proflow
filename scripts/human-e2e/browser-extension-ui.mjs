import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "browser-extension-ui.swift");
const digest = createHash("sha256")
	.update(readFileSync(source))
	.digest("hex")
	.slice(0, 16);
const binary = join(tmpdir(), `proflow-browser-extension-ui-${digest}`);
const compileOnly = process.argv.slice(2).includes("--compile-only");
const args = process.argv
	.slice(2)
	.filter((value) => value !== "--" && value !== "--compile-only");

if (!existsSync(binary)) {
	const started = performance.now();
	const compiled = spawnSync("swiftc", [source, "-o", binary], {
		stdio: "inherit",
	});
	if (compiled.status !== 0) process.exit(compiled.status ?? 1);
	process.stderr.write(
		`BROWSER_HARNESS_COMPILE_SECONDS=${((performance.now() - started) / 1000).toFixed(3)}\n`,
	);
}

if (compileOnly) process.exit(0);
const result = spawnSync(binary, args, { stdio: "inherit", env: process.env });
process.exit(result.status ?? 1);

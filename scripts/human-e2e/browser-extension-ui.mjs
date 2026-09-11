import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { probeChromeExtensionState } from "../../packages/execution-browser-extension/src/chrome-extension-state.ts";

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
const action = args[0] ?? "status";

async function assertInstallPrecondition() {
	if (action !== "install") return;
	const workspace = process.env.PROFLOW_WORKSPACE;
	if (!workspace) {
		process.stderr.write("BROWSER_UI_ERROR=INSTALL_WORKSPACE_REQUIRED\n");
		process.exit(64);
	}
	const loadDir =
		process.env.PROFLOW_BROWSER_EXTENSION_LOAD_DIR ??
		join(
			workspace,
			".proflow",
			"deployment",
			"browser-extension",
			"execution-browser-extension",
		);
	const extensionId =
		process.env.PROFLOW_BROWSER_EXTENSION_ID ??
		"eehdadpmjffomabiedcjijiakconalab";
	const userDataRoot = process.env.PROFLOW_CHROME_USER_DATA_ROOT;
	const observed = await probeChromeExtensionState({
		extensionId,
		loadDir,
		...(userDataRoot ? { userDataRoot } : {}),
	});
	if (observed !== "MISSING") {
		process.stderr.write(
			`BROWSER_UI_ERROR=INSTALL_REQUIRES_MISSING_EXTENSION:${observed}\n`,
		);
		process.exit(65);
	}
	process.stdout.write("BROWSER_INSTALL_PRECONDITION=MISSING\n");
}

await assertInstallPrecondition();

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

import assert from "node:assert/strict";
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { runCli } from "../src/cli.ts";
import { tempWorkspace, writeInstalledModule } from "./test-helpers.ts";

const execFileAsync = promisify(execFile);
const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const packageName = "@tomflow/proflow-cross-process-service";

async function reservePort(): Promise<number> {
	const server = createServer();
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("PORT_RESERVE_FAILED");
	await new Promise<void>((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve())),
	);
	return address.port;
}
async function waitUntil(
	predicate: () => Promise<boolean>,
	timeoutMs = 30_000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error("WAIT_TIMEOUT");
}

async function isHealthy(port: number): Promise<boolean> {
	try {
		return (
			await fetch(`http://127.0.0.1:${port}/health`, {
				signal: AbortSignal.timeout(200),
			})
		).ok;
	} catch {
		return false;
	}
}

async function stopChild(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) return;
	child.kill("SIGTERM");
	await Promise.race([
		once(child, "exit"),
		new Promise((resolve) => setTimeout(resolve, 1_000)),
	]);
	if (child.exitCode === null && child.signalCode === null)
		child.kill("SIGKILL");
}
function adapterSource(port: number): string {
	return `
import { createServer } from "node:http";
let server;
const port = ${port};
const base = { contract: "deployment.result.v1", ok: true, status: "SUCCEEDED", moduleRef: "cross-process-service", moduleVersion: "1.0.0" };
const running = async () => {
  try { return (await fetch("http://127.0.0.1:" + port + "/health", { signal: AbortSignal.timeout(200) })).ok; }
  catch { return false; }
};
export const behaviorAdapter = {
  install: async () => ({ result: base, observedEffects: [] }),
  uninstall: async () => ({ result: base, observedEffects: [] }),
  setup: async () => ({ result: base, observedEffects: [] }),
  docs: async () => ({ result: { ...base, data: { docs: "fixture" } }, observedEffects: [] }),
  status: async () => ({ result: { ...base, data: { setupStatus: "READY", runtimeStatus: (await running()) ? "RUNNING" : "STOPPED" } }, observedEffects: [] }),
  start: async () => {
    server = createServer((request, response) => { response.writeHead(request.url === "/health" ? 200 : 404).end(); });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
    return { result: base, observedEffects: ["Manage fixture process"] };
  },
  stop: async () => {
    if (!server) return { result: (await running()) ? { ...base, ok: false, status: "FAILED", error: { code: "STOP_FAILED", message: "fixture is running without an owned lifecycle handle", retryable: true } } : base, observedEffects: [] };
    const current = server; server = undefined;
    await new Promise((resolve, reject) => current.close((error) => error ? reject(error) : resolve()));
    return { result: base, observedEffects: ["Manage fixture process"] };
  },
};\n`;
}
test("CP-DEP-CLI-FINAL-02 platform stop reaches the original foreground start owner across CLI processes", async () => {
	const root = await tempWorkspace();
	const port = await reservePort();
	await writeInstalledModule(root, {
		moduleRef: "cross-process-service",
		packageName,
		kind: "service",
		adapterSource: adapterSource(port),
	});
	const manifest = JSON.parse(await readFile(`${root}/package.json`, "utf8"));
	manifest.dependencies = { [packageName]: "1.0.0" };
	await writeFile(`${root}/package.json`, JSON.stringify(manifest));

	const start = spawn(
		process.execPath,
		[cliPath, "start", "--workspace", root],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	let startOutput = "";
	start.stdout?.on("data", (chunk) => (startOutput += String(chunk)));
	start.stderr?.on("data", (chunk) => (startOutput += String(chunk)));
	try {
		await waitUntil(() => isHealthy(port), 90_000);
		await waitUntil(async () => {
			try {
				await readFile(
					`${root}/.proflow/runtime/platform-cli/start-owner.json`,
					"utf8",
				);
				return true;
			} catch {
				return false;
			}
		});
		assert.equal(start.exitCode, null, startOutput);

		const stopped = await execFileAsync(
			process.execPath,
			[cliPath, "stop", "--workspace", root],
			{ encoding: "utf8", timeout: 90_000 },
		);
		assert.match(stopped.stdout, /平台停止完成/);
		await waitUntil(async () => !(await isHealthy(port)));
		if (start.exitCode === null && start.signalCode === null)
			await once(start, "exit");
		assert.equal(start.exitCode, 0, startOutput);

		const status = await execFileAsync(
			process.execPath,
			[cliPath, "status", "--workspace", root],
			{ encoding: "utf8", timeout: 30_000 },
		);
		assert.match(
			status.stdout,
			/PLATFORM_READY=YES|无独立进程|已停止|0 个真实服务进程/,
		);
	} finally {
		await stopChild(start);
		await rm(root, { recursive: true, force: true });
	}
});

test("platform uninstall stops the original foreground start owner before package removal", async () => {
	const root = await tempWorkspace();
	const port = await reservePort();
	await writeInstalledModule(root, {
		moduleRef: "cross-process-service",
		packageName,
		kind: "service",
		adapterSource: adapterSource(port),
	});
	const manifest = JSON.parse(await readFile(`${root}/package.json`, "utf8"));
	manifest.dependencies = { [packageName]: "1.0.0" };
	await writeFile(`${root}/package.json`, JSON.stringify(manifest));

	const start = spawn(
		process.execPath,
		[cliPath, "start", "--workspace", root],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	let startOutput = "";
	start.stdout?.on("data", (chunk) => (startOutput += String(chunk)));
	start.stderr?.on("data", (chunk) => (startOutput += String(chunk)));
	try {
		await waitUntil(() => isHealthy(port), 90_000);
		await waitUntil(async () => {
			try {
				await readFile(
					`${root}/.proflow/runtime/platform-cli/start-owner.json`,
					"utf8",
				);
				return true;
			} catch {
				return false;
			}
		});
		assert.equal(start.exitCode, null, startOutput);
		const packageCalls: string[][] = [];
		const result = await runCli(["uninstall", "--workspace", root], {
			cwd: root,
			executableAvailable: () => true,
			packageRunner: {
				async run(command, args) {
					packageCalls.push([command, ...args]);
					if (!args.includes("uninstall"))
						throw new Error(
							`unexpected package-manager call: ${command} ${args.join(" ")}`,
						);
					const current = JSON.parse(
						await readFile(`${root}/package.json`, "utf8"),
					);
					await writeFile(
						`${root}/package.json`,
						JSON.stringify({ ...current, dependencies: {} }),
					);
					return "";
				},
			},
		});
		assert.equal(result.status, "SUCCEEDED");
		await waitUntil(async () => !(await isHealthy(port)), 5_000);
		if (start.exitCode === null && start.signalCode === null)
			await once(start, "exit");
		assert.equal(start.exitCode, 0, startOutput);
		assert.equal(packageCalls.length, 1);
		assert.ok(packageCalls[0]?.includes("uninstall"));
	} finally {
		await stopChild(start);
		await rm(root, { recursive: true, force: true });
	}
});

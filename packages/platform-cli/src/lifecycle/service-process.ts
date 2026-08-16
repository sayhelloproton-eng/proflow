import { execFile, spawn } from "node:child_process";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
	type ModuleOperationResult,
	serviceProcessBindingSchema,
	type ServiceProcessBinding,
} from "@tomflow/proflow-module-contract";

import type { ResolvedModule } from "../contracts.ts";
import { writeJsonAtomic } from "../persistence/atomic.ts";
import type { WorkspacePaths } from "../paths.ts";

const execFileAsync = promisify(execFile);

interface ManagedServiceRecord {
	contract: "deployment.service-process-state.v1";
	moduleRef: string;
	packageName: string;
	moduleVersion: string;
	pid: number;
	startedAt: string;
	binPath: string;
	configPath: string;
	stdoutPath: string;
	stderrPath: string;
}

export interface ManagedServiceInvocation {
	result: ModuleOperationResult;
	observedEffects: string[];
}

function base(module: ResolvedModule) {
	return {
		contract: "deployment.result.v1" as const,
		ok: true,
		status: "SUCCEEDED" as const,
		moduleRef: module.moduleRef,
		moduleVersion: module.moduleVersion,
	};
}

function actionRequired(
	module: ResolvedModule,
	action: string,
	description: string,
	checks: ModuleOperationResult["checks"] = [],
): ModuleOperationResult {
	return {
		...base(module),
		ok: false,
		status: "ACTION_REQUIRED",
		actionRequired: { action, description },
		checks,
	};
}

function failed(module: ResolvedModule, message: string): ModuleOperationResult {
	return {
		...base(module),
		ok: false,
		status: "FAILED",
		error: { code: "COMMAND_FAILED", message, retryable: true },
	};
}

function serviceDir(paths: WorkspacePaths, moduleRef: string): string {
	return join(paths.runtime, "services", moduleRef);
}

function recordPath(paths: WorkspacePaths, moduleRef: string): string {
	return join(serviceDir(paths, moduleRef), "process.json");
}

async function readRecord(
	paths: WorkspacePaths,
	moduleRef: string,
): Promise<ManagedServiceRecord | undefined> {
	try {
		const raw = JSON.parse(await readFile(recordPath(paths, moduleRef), "utf8")) as unknown;
		if (typeof raw !== "object" || raw === null) return undefined;
		const value = raw as Partial<ManagedServiceRecord>;
		if (
			value.contract !== "deployment.service-process-state.v1" ||
			typeof value.pid !== "number" ||
			typeof value.moduleRef !== "string" ||
			typeof value.packageName !== "string" ||
			typeof value.moduleVersion !== "string" ||
			typeof value.binPath !== "string" ||
			typeof value.configPath !== "string" ||
			typeof value.stdoutPath !== "string" ||
			typeof value.stderrPath !== "string" ||
			typeof value.startedAt !== "string"
		) return undefined;
		return value as ManagedServiceRecord;
	} catch {
		return undefined;
	}
}

function recordIdentityMatchesModule(
	record: ManagedServiceRecord,
	module: ResolvedModule,
): boolean {
	return (
		record.moduleRef === module.moduleRef &&
		record.packageName === module.packageName
	);
}

function recordVersionMatchesModule(
	record: ManagedServiceRecord,
	module: ResolvedModule,
): boolean {
	return record.moduleVersion === module.moduleVersion;
}

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function isOwnedProcess(record: ManagedServiceRecord): Promise<boolean> {
	if (!isAlive(record.pid)) return false;
	try {
		let commandLine: string;
		if (process.platform === "win32") {
			const result = await execFileAsync(
				"powershell.exe",
				[
					"-NoProfile",
					"-Command",
					`(Get-CimInstance Win32_Process -Filter "ProcessId = ${record.pid}").CommandLine`,
				],
				{ encoding: "utf8" },
			);
			commandLine = result.stdout;
		} else {
			const result = await execFileAsync(
				"ps",
				["-p", String(record.pid), "-o", "command="],
				{ encoding: "utf8" },
			);
			commandLine = result.stdout;
		}
		return commandLine.includes(record.binPath) && commandLine.includes(record.configPath);
	} catch {
		return false;
	}
}

async function removeRecord(paths: WorkspacePaths, moduleRef: string): Promise<void> {
	await rm(recordPath(paths, moduleRef), { force: true });
}

async function resolvePackageRoot(
	workspaceRoot: string,
	module: ResolvedModule,
): Promise<string> {
	if (module.source.type === "workspace") {
		if (!module.source.path) throw new Error(`workspace source missing path for ${module.packageName}`);
		return module.source.path;
	}
	if (module.source.type !== "installed") {
		throw new Error(`registry bootstrap target ${module.packageName} has no local package root`);
	}
	const require = createRequire(pathToFileURL(join(workspaceRoot, "package.json")));
	const artifact = require.resolve(`${module.packageName}/deployment/descriptor`);
	let current = dirname(artifact);
	for (;;) {
		try {
			const parsed = JSON.parse(await readFile(join(current, "package.json"), "utf8")) as { name?: unknown };
			if (parsed.name === module.packageName) return current;
		} catch {
			// keep walking upward
		}
		const parent = dirname(current);
		if (parent === current) throw new Error(`package root not found for ${module.packageName}`);
		current = parent;
	}
}

async function resolveOwnedBin(
	workspaceRoot: string,
	module: ResolvedModule,
	binding: ServiceProcessBinding,
): Promise<string> {
	const packageRoot = await resolvePackageRoot(workspaceRoot, module);
	const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as {
		bin?: string | Record<string, string>;
	};
	const relative = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[binding.bin];
	if (typeof relative !== "string") throw new Error(`package ${module.packageName} does not own bin ${binding.bin}`);
	const target = resolve(packageRoot, relative);
	const root = resolve(packageRoot);
	if (target !== root && !target.startsWith(`${root}/`)) throw new Error(`service bin escapes package root: ${relative}`);
	return target;
}

export async function managedServiceStatus(
	paths: WorkspacePaths,
	module: ResolvedModule,
): Promise<ManagedServiceInvocation> {
	const record = await readRecord(paths, module.moduleRef);
	if (!record || !(await isOwnedProcess(record))) {
		if (record) await removeRecord(paths, module.moduleRef);
		return {
			result: actionRequired(module, "start-service", "Service process is not running", [
				{ id: "service-process-live", status: "FAIL", message: "No live managed service process" },
			]),
			observedEffects: [],
		};
	}
	if (!recordIdentityMatchesModule(record, module)) {
		return {
			result: failed(module, "managed service state identity does not match the current module"),
			observedEffects: [],
		};
	}
	if (!recordVersionMatchesModule(record, module)) {
		return {
			result: actionRequired(
				module,
				"restart-service",
				`Managed service process is still running package version ${record.moduleVersion}; restart is required for ${module.moduleVersion}`,
				[{ id: "service-process-version", status: "FAIL", message: `Running ${record.moduleVersion}, installed ${module.moduleVersion}` }],
			),
			observedEffects: [],
		};
	}
	return {
		result: {
			...base(module),
			data: { state: "RUNNING", pid: record.pid, startedAt: record.startedAt },
			checks: [{ id: "service-process-live", status: "PASS", message: `Managed service process ${record.pid} is alive` }],
		},
		observedEffects: [],
	};
}

export async function startManagedService(
	paths: WorkspacePaths,
	module: ResolvedModule,
	rawBinding: unknown,
): Promise<ManagedServiceInvocation> {
	const existing = await readRecord(paths, module.moduleRef);
	if (existing && (await isOwnedProcess(existing))) {
		if (!recordIdentityMatchesModule(existing, module)) {
			return { result: failed(module, "managed service state identity does not match the current module"), observedEffects: [] };
		}
		return managedServiceStatus(paths, module);
	}
	if (existing) await removeRecord(paths, module.moduleRef);
	const binding = serviceProcessBindingSchema.parse(rawBinding);
	let binPath: string;
	try {
		binPath = await resolveOwnedBin(paths.root, module, binding);
	} catch (error) {
		return { result: failed(module, error instanceof Error ? error.message : String(error)), observedEffects: [] };
	}
	const dir = serviceDir(paths, module.moduleRef);
	const configPath = join(dir, "config.json");
	const stdoutPath = join(paths.logsDeployment, `${module.moduleRef}.stdout.log`);
	const stderrPath = join(paths.logsDeployment, `${module.moduleRef}.stderr.log`);
	await writeJsonAtomic(configPath, binding.config, 0o600);
	await mkdir(paths.logsDeployment, { recursive: true });
	const stdout = await open(stdoutPath, "a");
	const stderr = await open(stderrPath, "a");
	try {
		const child = spawn(process.execPath, [binPath, binding.startCommand, configPath], {
			cwd: paths.root,
			detached: true,
			env: process.env,
			stdio: ["ignore", stdout.fd, stderr.fd],
		});
		await new Promise<void>((resolveSpawn, rejectSpawn) => {
			child.once("spawn", resolveSpawn);
			child.once("error", rejectSpawn);
		});
		if (child.pid === undefined) return { result: failed(module, "service process spawned without pid"), observedEffects: [] };
		child.unref();
		const record: ManagedServiceRecord = {
			contract: "deployment.service-process-state.v1",
			moduleRef: module.moduleRef,
			packageName: module.packageName,
			moduleVersion: module.moduleVersion,
			pid: child.pid,
			startedAt: new Date().toISOString(),
			binPath,
			configPath,
			stdoutPath,
			stderrPath,
		};
		await writeJsonAtomic(recordPath(paths, module.moduleRef), record, 0o600);
		return {
			result: { ...base(module), data: { state: "RUNNING", pid: child.pid } },
			observedEffects: ["Manage the declared service process"],
		};
	} catch (error) {
		return { result: failed(module, error instanceof Error ? error.message : String(error)), observedEffects: [] };
	} finally {
		await Promise.all([stdout.close(), stderr.close()]);
	}
}

async function waitForExit(pid: number, timeoutMs = 2_000): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (!isAlive(pid)) return true;
		await new Promise((resolveWait) => setTimeout(resolveWait, 50));
	}
	return !isAlive(pid);
}

export async function stopManagedService(
	paths: WorkspacePaths,
	module: ResolvedModule,
): Promise<ManagedServiceInvocation> {
	const record = await readRecord(paths, module.moduleRef);
	if (!record || !(await isOwnedProcess(record))) {
		if (record) await removeRecord(paths, module.moduleRef);
		return { result: { ...base(module), data: { state: "STOPPED" } }, observedEffects: [] };
	}
	if (!recordIdentityMatchesModule(record, module)) {
		return {
			result: failed(module, "managed service state identity does not match the current module"),
			observedEffects: [],
		};
	}
	try {
		process.kill(record.pid, "SIGTERM");
		if (!(await waitForExit(record.pid))) {
			return { result: failed(module, `service process ${record.pid} did not stop after SIGTERM`), observedEffects: [] };
		}
		await removeRecord(paths, module.moduleRef);
		return {
			result: { ...base(module), data: { state: "STOPPED", pid: record.pid } },
			observedEffects: ["Manage the declared service process"],
		};
	} catch (error) {
		return { result: failed(module, error instanceof Error ? error.message : String(error)), observedEffects: [] };
	}
}

export async function restartManagedService(
	paths: WorkspacePaths,
	module: ResolvedModule,
	binding: unknown,
): Promise<ManagedServiceInvocation> {
	const stopped = await stopManagedService(paths, module);
	if (stopped.result.status === "FAILED") return stopped;
	return startManagedService(paths, module, binding);
}

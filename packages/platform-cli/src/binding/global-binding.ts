import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
	access,
	chmod,
	mkdir,
	open,
	readFile,
	realpath,
	rm,
	stat,
	unlink,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { PlatformError } from "../errors.ts";
import { atomicWrite } from "../paths.ts";

export const GLOBAL_BINDING_CONTRACT = "deployment.global-binding.v1" as const;
export const WORKSPACE_INSTANCE_CONTRACT =
	"deployment.workspace-instance.v1" as const;

export type GlobalBindingState =
	| "INSTALLING"
	| "INSTALLED"
	| "UNINSTALLING"
	| "BROKEN";

export interface GlobalWorkspaceBinding {
	contract: typeof GLOBAL_BINDING_CONTRACT;
	state: GlobalBindingState;
	workspacePath: string;
	workspaceRealPath: string;
	workspaceInstanceId: string;
	createdAt: string;
	updatedAt: string;
	failure?: {
		code: string;
		message: string;
	};
}

export interface WorkspaceInstanceMarker {
	contract: typeof WORKSPACE_INSTANCE_CONTRACT;
	workspaceInstanceId: string;
	workspaceRealPath: string;
	createdAt: string;
}

export interface GlobalPlatformPaths {
	root: string;
	bindingJson: string;
	bindingLock: string;
	operationLock: string;
}

export interface BoundWorkspaceObservation {
	binding: GlobalWorkspaceBinding;
	workspaceExists: boolean;
}

export interface GlobalBindingLockHandle {
	release(): Promise<void>;
}

export function globalPlatformPaths(globalRoot?: string): GlobalPlatformPaths {
	const root =
		globalRoot ??
		process.env.PROFLOW_GLOBAL_HOME ??
		join(homedir(), ".proflow", "platform");
	return {
		root,
		bindingJson: join(root, "binding.json"),
		bindingLock: join(root, "binding.lock"),
		operationLock: join(root, "operation.lock"),
	};
}

export async function canonicalizeWorkspace(
	workspace: string,
): Promise<{ workspacePath: string; workspaceRealPath: string }> {
	const workspacePath = resolve(workspace);
	let info: Awaited<ReturnType<typeof stat>>;
	try {
		info = await stat(workspacePath);
	} catch {
		throw new PlatformError(
			"WORKSPACE_NOT_FOUND",
			`workspace does not exist: ${workspacePath}`,
		);
	}
	if (!info.isDirectory()) {
		throw new PlatformError(
			"WORKSPACE_NOT_FOUND",
			`workspace is not a directory: ${workspacePath}`,
		);
	}
	try {
		await access(workspacePath, constants.R_OK | constants.W_OK);
	} catch {
		throw new PlatformError(
			"WORKSPACE_NOT_WRITABLE",
			`workspace is not readable and writable: ${workspacePath}`,
		);
	}
	return { workspacePath, workspaceRealPath: await realpath(workspacePath) };
}

export async function loadGlobalBinding(
	globalRoot?: string,
): Promise<GlobalWorkspaceBinding | undefined> {
	const paths = globalPlatformPaths(globalRoot);
	try {
		const raw = await readFile(paths.bindingJson, "utf8");
		const parsed: unknown = JSON.parse(raw);
		if (!isGlobalWorkspaceBinding(parsed)) {
			throw new PlatformError(
				"GLOBAL_BINDING_INVALID",
				`global binding is invalid: ${paths.bindingJson}`,
			);
		}
		return parsed;
	} catch (error) {
		if (isMissingFile(error)) return undefined;
		if (error instanceof PlatformError) throw error;
		throw new PlatformError(
			"GLOBAL_BINDING_INVALID",
			`cannot read global binding ${paths.bindingJson}: ${errorMessage(error)}`,
		);
	}
}

export async function observeBoundWorkspace(
	globalRoot?: string,
): Promise<BoundWorkspaceObservation | undefined> {
	const binding = await loadGlobalBinding(globalRoot);
	if (binding === undefined) return undefined;
	return {
		binding,
		workspaceExists: await directoryExists(binding.workspaceRealPath),
	};
}

export async function requireBoundWorkspace(
	globalRoot?: string,
): Promise<GlobalWorkspaceBinding> {
	const observation = await observeBoundWorkspace(globalRoot);
	if (observation === undefined) {
		throw new PlatformError(
			"WORKSPACE_NOT_BOUND",
			"no ProFlow Workspace is currently installed/bound",
		);
	}
	if (!observation.workspaceExists) {
		throw new PlatformError(
			"BOUND_WORKSPACE_MISSING",
			`bound Workspace no longer exists: ${observation.binding.workspaceRealPath}`,
		);
	}
	return observation.binding;
}

export async function claimWorkspaceBinding(options: {
	workspace: string;
	globalRoot?: string | undefined;
}): Promise<{
	binding: GlobalWorkspaceBinding;
	alreadyBound: boolean;
}> {
	const requested = await canonicalizeWorkspace(options.workspace);
	const paths = globalPlatformPaths(options.globalRoot);
	const lock = await acquireGlobalBindingLock(paths);
	try {
		const current = await loadGlobalBinding(options.globalRoot);
		if (current !== undefined) {
			if (current.workspaceRealPath !== requested.workspaceRealPath) {
				throw new PlatformError(
					"WORKSPACE_ALREADY_BOUND",
					`ProFlow is already bound to ${current.workspaceRealPath}; uninstall it before installing ${requested.workspaceRealPath}`,
				);
			}
			return { binding: current, alreadyBound: true };
		}

		const existingMarker = await loadWorkspaceInstanceMarker(
			requested.workspaceRealPath,
		);
		const now = new Date().toISOString();
		const binding: GlobalWorkspaceBinding = {
			contract: GLOBAL_BINDING_CONTRACT,
			state: "INSTALLING",
			workspacePath: requested.workspacePath,
			workspaceRealPath: requested.workspaceRealPath,
			workspaceInstanceId: existingMarker?.workspaceInstanceId ?? randomUUID(),
			createdAt: existingMarker?.createdAt ?? now,
			updatedAt: now,
		};
		await saveGlobalBinding(paths, binding);
		if (existingMarker === undefined) {
			try {
				await writeWorkspaceInstanceMarker(binding);
			} catch (error) {
				const broken = withBindingState(binding, "BROKEN", {
					code: "WORKSPACE_INSTANCE_WRITE_FAILED",
					message: errorMessage(error),
				});
				await saveGlobalBinding(paths, broken);
				throw new PlatformError(
					"GLOBAL_BINDING_INVALID",
					`failed to materialize Workspace instance identity: ${errorMessage(error)}`,
				);
			}
		}
		return { binding, alreadyBound: false };
	} finally {
		await lock.release();
	}
}

export async function updateGlobalBindingState(options: {
	workspaceInstanceId: string;
	state: GlobalBindingState;
	globalRoot?: string | undefined;
	failure?: { code: string; message: string };
}): Promise<GlobalWorkspaceBinding> {
	const paths = globalPlatformPaths(options.globalRoot);
	const lock = await acquireGlobalBindingLock(paths);
	try {
		const current = await loadGlobalBinding(options.globalRoot);
		if (current === undefined) {
			throw new PlatformError(
				"WORKSPACE_NOT_BOUND",
				"cannot update global binding because no Workspace is bound",
			);
		}
		if (current.workspaceInstanceId !== options.workspaceInstanceId) {
			throw new PlatformError(
				"GLOBAL_BINDING_INVALID",
				"global binding instance identity changed during the operation",
			);
		}
		const next = withBindingState(current, options.state, options.failure);
		await saveGlobalBinding(paths, next);
		return next;
	} finally {
		await lock.release();
	}
}

export async function clearGlobalBinding(options: {
	workspaceInstanceId: string;
	globalRoot?: string | undefined;
	removeWorkspaceMarker?: boolean;
}): Promise<void> {
	const paths = globalPlatformPaths(options.globalRoot);
	const lock = await acquireGlobalBindingLock(paths);
	try {
		const current = await loadGlobalBinding(options.globalRoot);
		if (current === undefined) return;
		if (current.workspaceInstanceId !== options.workspaceInstanceId) {
			throw new PlatformError(
				"GLOBAL_BINDING_INVALID",
				"refusing to clear a different Workspace binding",
			);
		}
		await rm(paths.bindingJson, { force: true });
		if (options.removeWorkspaceMarker === true) {
			await rm(workspaceInstanceMarkerPath(current.workspaceRealPath), {
				force: true,
			});
		}
	} finally {
		await lock.release();
	}
}

export async function forgetMissingWorkspaceBinding(options: {
	globalRoot?: string | undefined;
}): Promise<GlobalWorkspaceBinding> {
	const paths = globalPlatformPaths(options.globalRoot);
	const lock = await acquireGlobalBindingLock(paths);
	try {
		const current = await loadGlobalBinding(options.globalRoot);
		if (current === undefined) {
			throw new PlatformError(
				"WORKSPACE_NOT_BOUND",
				"no ProFlow Workspace binding exists to forget",
			);
		}
		if (await directoryExists(current.workspaceRealPath)) {
			throw new PlatformError(
				"INVALID_REQUEST",
				"bound Workspace still exists; use normal platform uninstall instead of forget",
			);
		}
		await rm(paths.bindingJson, { force: true });
		return current;
	} finally {
		await lock.release();
	}
}

export async function acquireGlobalBindingLock(
	paths: GlobalPlatformPaths,
): Promise<GlobalBindingLockHandle> {
	return acquireExclusiveGlobalLock(
		paths.root,
		paths.bindingLock,
		"GLOBAL_BINDING_LOCKED",
		"another process is mutating the global Workspace binding",
	);
}

export async function acquireGlobalOperationLock(
	globalRoot?: string,
): Promise<GlobalBindingLockHandle> {
	const paths = globalPlatformPaths(globalRoot);
	return acquireExclusiveGlobalLock(
		paths.root,
		paths.operationLock,
		"GLOBAL_OPERATION_LOCKED",
		"another Platform install/uninstall operation is already running",
	);
}

async function acquireExclusiveGlobalLock(
	root: string,
	file: string,
	code: "GLOBAL_BINDING_LOCKED" | "GLOBAL_OPERATION_LOCKED",
	message: string,
): Promise<GlobalBindingLockHandle> {
	await mkdir(root, { recursive: true });
	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			const handle = await open(file, "wx", 0o600);
			try {
				await handle.writeFile(
					`${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`,
					"utf8",
				);
			} finally {
				await handle.close();
			}
			return {
				async release() {
					try {
						await unlink(file);
					} catch (error) {
						if (!isMissingFile(error)) throw error;
					}
				},
			};
		} catch (error) {
			if (!isAlreadyExists(error)) throw error;
			const record = await readLockRecord(file);
			if (record !== undefined && !pidIsAlive(record.pid)) {
				await rm(file, { force: true });
				continue;
			}
			throw new PlatformError(code, `${message}: ${file}`);
		}
	}
	throw new PlatformError(code, `${message}: ${file}`);
}

function workspaceInstanceMarkerPath(workspaceRoot: string): string {
	return join(workspaceRoot, ".proflow", "deployment", "instance.json");
}

async function loadWorkspaceInstanceMarker(
	workspaceRoot: string,
): Promise<WorkspaceInstanceMarker | undefined> {
	const path = workspaceInstanceMarkerPath(workspaceRoot);
	try {
		const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
		if (!isWorkspaceInstanceMarker(parsed)) {
			throw new PlatformError(
				"WORKSPACE_INSTANCE_INVALID",
				`Workspace instance marker is invalid: ${path}`,
			);
		}
		if (parsed.workspaceRealPath !== workspaceRoot) {
			throw new PlatformError(
				"WORKSPACE_INSTANCE_INVALID",
				`Workspace instance marker belongs to ${parsed.workspaceRealPath}, not ${workspaceRoot}`,
			);
		}
		return parsed;
	} catch (error) {
		if (isMissingFile(error)) return undefined;
		if (error instanceof PlatformError) throw error;
		throw new PlatformError(
			"WORKSPACE_INSTANCE_INVALID",
			`cannot read Workspace instance marker ${path}: ${errorMessage(error)}`,
		);
	}
}

function isWorkspaceInstanceMarker(
	value: unknown,
): value is WorkspaceInstanceMarker {
	if (!isRecord(value)) return false;
	return (
		value.contract === WORKSPACE_INSTANCE_CONTRACT &&
		typeof value.workspaceInstanceId === "string" &&
		value.workspaceInstanceId.length > 0 &&
		typeof value.workspaceRealPath === "string" &&
		typeof value.createdAt === "string"
	);
}

async function writeWorkspaceInstanceMarker(
	binding: GlobalWorkspaceBinding,
): Promise<void> {
	const path = workspaceInstanceMarkerPath(binding.workspaceRealPath);
	const marker: WorkspaceInstanceMarker = {
		contract: WORKSPACE_INSTANCE_CONTRACT,
		workspaceInstanceId: binding.workspaceInstanceId,
		workspaceRealPath: binding.workspaceRealPath,
		createdAt: binding.createdAt,
	};
	await mkdir(dirname(path), { recursive: true });
	await atomicWrite(path, `${JSON.stringify(marker, null, 2)}\n`);
	await chmod(path, 0o600);
}

async function saveGlobalBinding(
	paths: GlobalPlatformPaths,
	binding: GlobalWorkspaceBinding,
): Promise<void> {
	await mkdir(paths.root, { recursive: true });
	await atomicWrite(paths.bindingJson, `${JSON.stringify(binding, null, 2)}\n`);
	await chmod(paths.bindingJson, 0o600);
}

function withBindingState(
	binding: GlobalWorkspaceBinding,
	state: GlobalBindingState,
	failure?: { code: string; message: string },
): GlobalWorkspaceBinding {
	const { failure: _previousFailure, ...base } = binding;
	return {
		...base,
		state,
		updatedAt: new Date().toISOString(),
		...(failure === undefined ? {} : { failure }),
	};
}

function isGlobalWorkspaceBinding(
	value: unknown,
): value is GlobalWorkspaceBinding {
	if (!isRecord(value)) return false;
	if (value.contract !== GLOBAL_BINDING_CONTRACT) return false;
	if (!isBindingState(value.state)) return false;
	return (
		typeof value.workspacePath === "string" &&
		typeof value.workspaceRealPath === "string" &&
		typeof value.workspaceInstanceId === "string" &&
		typeof value.createdAt === "string" &&
		typeof value.updatedAt === "string" &&
		(value.failure === undefined ||
			(isRecord(value.failure) &&
				typeof value.failure.code === "string" &&
				typeof value.failure.message === "string"))
	);
}

function isBindingState(value: unknown): value is GlobalBindingState {
	return (
		value === "INSTALLING" ||
		value === "INSTALLED" ||
		value === "UNINSTALLING" ||
		value === "BROKEN"
	);
}

async function directoryExists(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isDirectory();
	} catch {
		return false;
	}
}

async function readLockRecord(
	path: string,
): Promise<{ pid: number } | undefined> {
	try {
		const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
		if (
			isRecord(parsed) &&
			typeof parsed.pid === "number" &&
			Number.isInteger(parsed.pid) &&
			parsed.pid > 0
		) {
			return { pid: parsed.pid };
		}
		return undefined;
	} catch {
		return undefined;
	}
}

function pidIsAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return isPermissionError(error);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFile(error: unknown): boolean {
	return isRecord(error) && error.code === "ENOENT";
}

function isAlreadyExists(error: unknown): boolean {
	return isRecord(error) && error.code === "EEXIST";
}

function isPermissionError(error: unknown): boolean {
	return isRecord(error) && error.code === "EPERM";
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

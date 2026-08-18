import { createHash } from "node:crypto";
import {
	type FileHandle,
	mkdir,
	open,
	readFile,
	realpath,
	unlink,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import type { LockRecord } from "../contracts.ts";
import { PlatformError } from "../errors.ts";
import type { WorkspacePaths } from "../paths.ts";
import { isLockRecord } from "../persistence/guards.ts";

export interface WorkspaceLockHandle {
	record: LockRecord;
	release(): Promise<void>;
}

export function workspaceLockPath(paths: WorkspacePaths): string {
	return join(paths.runtime, "apply.lock");
}

function errorHasCode(error: unknown, code: string): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === code
	);
}

async function computeFingerprint(root: string): Promise<string> {
	let canonical = root;
	try {
		canonical = await realpath(root);
	} catch {
		canonical = resolve(root);
	}
	return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

export async function readWorkspaceLock(
	paths: WorkspacePaths,
): Promise<LockRecord | undefined> {
	let raw: string;
	try {
		raw = await readFile(workspaceLockPath(paths), "utf8");
	} catch {
		return undefined;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return undefined;
	}
	return isLockRecord(parsed) ? parsed : undefined;
}

function lockedError(existing: LockRecord | undefined): PlatformError {
	const details =
		existing === undefined
			? "existing lock is unreadable"
			: `pid=${existing.pid} planRef=${existing.planRef} since=${existing.createdAt} fingerprint=${existing.workspaceFingerprint}`;
	return new PlatformError(
		"WORKSPACE_LOCKED",
		`workspace apply already in progress (${details})`,
	);
}

function isProvablyDeadPid(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return false;
	} catch (error) {
		return errorHasCode(error, "ESRCH");
	}
}

async function reclaimProvablyStaleLock(
	paths: WorkspacePaths,
	expectedFingerprint: string,
): Promise<boolean> {
	const existing = await readWorkspaceLock(paths);
	if (
		existing === undefined ||
		existing.workspaceFingerprint !== expectedFingerprint ||
		!isProvablyDeadPid(existing.pid)
	) {
		return false;
	}
	try {
		await unlink(workspaceLockPath(paths));
		return true;
	} catch (error) {
		if (errorHasCode(error, "ENOENT")) return true;
		throw error;
	}
}

// v1 single-process exclusive lock: O_EXCL create, no distributed coordination,
// and no reclaim of a lock that cannot be proven stale.
export async function acquireWorkspaceLock(
	paths: WorkspacePaths,
	planRef: string,
): Promise<WorkspaceLockHandle> {
	const file = workspaceLockPath(paths);
	await mkdir(paths.runtime, { recursive: true });
	const record: LockRecord = {
		pid: process.pid,
		createdAt: new Date().toISOString(),
		planRef,
		workspaceFingerprint: await computeFingerprint(paths.root),
	};

	let handle: FileHandle;
	try {
		handle = await open(file, "wx", 0o644);
	} catch (error) {
		if (!errorHasCode(error, "EEXIST")) throw error;
		if (await reclaimProvablyStaleLock(paths, record.workspaceFingerprint)) {
			try {
				handle = await open(file, "wx", 0o644);
			} catch (retryError) {
				if (errorHasCode(retryError, "EEXIST")) {
					throw lockedError(await readWorkspaceLock(paths));
				}
				throw retryError;
			}
		} else {
			throw lockedError(await readWorkspaceLock(paths));
		}
	}
	try {
		await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, {
			encoding: "utf8",
		});
	} finally {
		await handle.close();
	}

	return {
		record,
		async release() {
			try {
				await unlink(file);
			} catch (error) {
				if (!errorHasCode(error, "ENOENT")) throw error;
			}
		},
	};
}

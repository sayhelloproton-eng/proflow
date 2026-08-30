import { execFile } from "node:child_process";
import { readFile, realpath, rm } from "node:fs/promises";
import { join, relative } from "node:path";

import { atomicWrite } from "../paths.ts";

const CONTRACT = "proflow.platform-start-owner.v1" as const;

interface StartOwnerRecord {
	contract: typeof CONTRACT;
	pid: number;
	workspaceRoot: string;
	processCwd: string;
	argv1: string;
	entrypointRealpath: string;
	startedAt: string;
}

const ownerFile = (root: string) =>
	join(root, ".proflow", "runtime", "platform-cli", "start-owner.json");
function processAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function commandLine(pid: number): Promise<string | undefined> {
	return new Promise((resolveCommand) => {
		execFile(
			"ps",
			["-p", String(pid), "-o", "command="],
			{ timeout: 2_000, encoding: "utf8" },
			(error, stdout) =>
				resolveCommand(error ? undefined : String(stdout).trim()),
		);
	});
}

function parseRecord(value: unknown): StartOwnerRecord | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value))
		return undefined;
	const item = value as Partial<StartOwnerRecord>;
	if (
		item.contract !== CONTRACT ||
		typeof item.pid !== "number" ||
		!Number.isInteger(item.pid) ||
		item.pid <= 0 ||
		typeof item.workspaceRoot !== "string" ||
		typeof item.processCwd !== "string" ||
		typeof item.argv1 !== "string" ||
		typeof item.entrypointRealpath !== "string" ||
		typeof item.startedAt !== "string" ||
		Number.isNaN(Date.parse(item.startedAt))
	)
		return undefined;
	return item as StartOwnerRecord;
}

async function readOwner(root: string): Promise<StartOwnerRecord | undefined> {
	try {
		return parseRecord(JSON.parse(await readFile(ownerFile(root), "utf8")));
	} catch {
		return undefined;
	}
}
async function ownerMatchesProcess(record: StartOwnerRecord): Promise<boolean> {
	if (!processAlive(record.pid)) return false;
	let observedEntrypoint: string;
	try {
		observedEntrypoint = await realpath(record.argv1);
	} catch {
		return false;
	}
	if (observedEntrypoint !== record.entrypointRealpath) return false;
	const observed = await commandLine(record.pid);
	if (!observed) return false;
	const relativeArgv = relative(record.processCwd, record.argv1);
	const entrypointMatches = [
		record.argv1,
		relativeArgv,
		`./${relativeArgv}`,
	].some((candidate) => candidate.length > 0 && observed.includes(candidate));
	return entrypointMatches && /(?:^|\s)start(?:\s|$)/.test(observed);
}

async function waitForExit(pid: number, timeoutMs = 60_000): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (!processAlive(pid)) return true;
		await new Promise((resolveWait) => setTimeout(resolveWait, 100));
	}
	return !processAlive(pid);
}
export async function registerStartOwner(root: string): Promise<void> {
	const argv1 = process.argv[1];
	if (!argv1) throw new Error("platform start entrypoint is unavailable");
	const record: StartOwnerRecord = {
		contract: CONTRACT,
		pid: process.pid,
		workspaceRoot: root,
		processCwd: process.cwd(),
		argv1,
		entrypointRealpath: await realpath(argv1),
		startedAt: new Date().toISOString(),
	};
	await atomicWrite(ownerFile(root), `${JSON.stringify(record, null, 2)}\n`);
}

export async function clearStartOwner(
	root: string,
	pid = process.pid,
): Promise<void> {
	const current = await readOwner(root);
	if (current?.pid !== pid) return;
	await rm(ownerFile(root), { force: true });
}
export async function requestStartOwnerStop(
	root: string,
): Promise<"ABSENT" | "STOPPED" | "UNVERIFIED" | "TIMEOUT"> {
	const record = await readOwner(root);
	if (!record) return "ABSENT";
	if (record.workspaceRoot !== root || !(await ownerMatchesProcess(record))) {
		if (!processAlive(record.pid)) await rm(ownerFile(root), { force: true });
		return "UNVERIFIED";
	}
	try {
		process.kill(record.pid, "SIGTERM");
	} catch {
		return "UNVERIFIED";
	}
	if (!(await waitForExit(record.pid))) return "TIMEOUT";
	await rm(ownerFile(root), { force: true });
	return "STOPPED";
}

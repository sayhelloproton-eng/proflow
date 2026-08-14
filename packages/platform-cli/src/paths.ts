import { randomBytes } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface WorkspacePaths {
	root: string;
	proflow: string;
	config: string;
	data: string;
	logs: string;
	logsDeployment: string;
	runtime: string;
	cache: string;
	tmp: string;
	deployment: string;
	stateJson: string;
	plans: string;
	verification: string;
	generated: string;
	installMd: string;
}

export function workspacePaths(root: string): WorkspacePaths {
	const proflow = join(root, ".proflow");
	const deployment = join(proflow, "deployment");
	return {
		root,
		proflow,
		config: join(proflow, "config"),
		data: join(proflow, "data"),
		logs: join(proflow, "logs"),
		logsDeployment: join(proflow, "logs", "deployment"),
		runtime: join(proflow, "runtime"),
		cache: join(proflow, "cache"),
		tmp: join(proflow, "tmp"),
		deployment,
		stateJson: join(deployment, "state.json"),
		plans: join(deployment, "plans"),
		verification: join(deployment, "verification"),
		generated: join(deployment, "generated"),
		installMd: join(deployment, "generated", "INSTALL.md"),
	};
}

export async function ensureLayout(paths: WorkspacePaths): Promise<void> {
	for (const dir of [
		paths.config,
		paths.data,
		paths.logsDeployment,
		paths.runtime,
		paths.cache,
		paths.tmp,
		paths.plans,
		paths.verification,
		paths.generated,
	]) {
		await mkdir(dir, { recursive: true });
	}
}

// Atomic write: bounded write to a temp sibling then rename into place.
export async function atomicWrite(
	file: string,
	content: string,
): Promise<void> {
	await mkdir(dirname(file), { recursive: true });
	const tmp = `${file}.tmp-${randomBytes(6).toString("hex")}`;
	await writeFile(tmp, content, "utf8");
	await rename(tmp, file);
}

export async function readJson<T>(file: string): Promise<T | undefined> {
	try {
		const { readFile } = await import("node:fs/promises");
		const raw = await readFile(file, "utf8");
		return JSON.parse(raw) as T;
	} catch {
		return undefined;
	}
}

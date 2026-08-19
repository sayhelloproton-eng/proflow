import { randomBytes } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface WorkspacePaths {
	root: string;
	proflow: string;
	config: string;
}

export function workspacePaths(root: string): WorkspacePaths {
	const proflow = join(root, ".proflow");
	return {
		root,
		proflow,
		config: join(proflow, "config"),
	};
}

export async function atomicWrite(
	file: string,
	content: string,
): Promise<void> {
	await mkdir(dirname(file), { recursive: true });
	const tmp = `${file}.tmp-${randomBytes(6).toString("hex")}`;
	await writeFile(tmp, content, "utf8");
	await rename(tmp, file);
}

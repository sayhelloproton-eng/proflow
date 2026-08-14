import { randomBytes } from "node:crypto";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

// Mode-aware atomic write: bounded write to a temp sibling, then rename into
// place. This is an enhancement of paths.atomicWrite that pins an explicit file
// mode (e.g. 0o600 for secret-bearing materialization) independent of umask.
export async function writeFileAtomic(
	file: string,
	content: string,
	mode = 0o644,
): Promise<void> {
	await mkdir(dirname(file), { recursive: true });
	const tmp = `${file}.tmp-${randomBytes(6).toString("hex")}`;
	await writeFile(tmp, content, { encoding: "utf8", mode });
	await chmod(tmp, mode);
	await rename(tmp, file);
}

export async function writeJsonAtomic(
	file: string,
	value: unknown,
	mode = 0o644,
): Promise<void> {
	await writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`, mode);
}

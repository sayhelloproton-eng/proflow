import type { WorkspacePaths } from "../paths.ts";
import { writeFileAtomic } from "./atomic.ts";

export async function writeInstallDoc(
	paths: WorkspacePaths,
	content: string,
): Promise<void> {
	await writeFileAtomic(paths.installMd, content, 0o644);
}

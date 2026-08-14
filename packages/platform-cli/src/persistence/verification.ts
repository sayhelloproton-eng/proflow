import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { VerificationRecord } from "../contracts.ts";
import type { WorkspacePaths } from "../paths.ts";
import { writeFileAtomic } from "./atomic.ts";
import { assertSafeFileName, isVerificationRecord } from "./guards.ts";

function verificationFilePath(
	paths: WorkspacePaths,
	moduleRef: string,
): string {
	assertSafeFileName(moduleRef, "moduleRef");
	return join(paths.verification, `${moduleRef}.jsonl`);
}

async function readJsonlLines(file: string): Promise<unknown[]> {
	let raw: string;
	try {
		raw = await readFile(file, "utf8");
	} catch {
		return [];
	}
	const lines: unknown[] = [];
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.length === 0) continue;
		try {
			lines.push(JSON.parse(trimmed));
		} catch {
			// skip a corrupt line rather than discarding otherwise valid history
		}
	}
	return lines;
}

// Verification history is append-only: existing records are preserved and the
// new record is appended, then the whole file is atomically replaced.
export async function appendVerification(
	paths: WorkspacePaths,
	record: VerificationRecord,
): Promise<void> {
	const file = verificationFilePath(paths, record.moduleRef);
	const records = (await readJsonlLines(file)).filter(isVerificationRecord);
	records.push(record);
	const content = `${records.map((item) => JSON.stringify(item)).join("\n")}\n`;
	await writeFileAtomic(file, content);
}

export async function loadVerificationHistory(
	paths: WorkspacePaths,
	moduleRef: string,
): Promise<VerificationRecord[]> {
	const lines = await readJsonlLines(verificationFilePath(paths, moduleRef));
	return lines.filter(isVerificationRecord);
}

export async function loadLatestVerification(
	paths: WorkspacePaths,
	moduleRef: string,
): Promise<VerificationRecord | undefined> {
	const history = await loadVerificationHistory(paths, moduleRef);
	return history[history.length - 1];
}

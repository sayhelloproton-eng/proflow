import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { inflateRawSync } from "node:zlib";

export type MaterializedKnowledgeFile = {
	name: string;
	relativePath: string;
	path: string;
	mime: string;
	sizeBytes: number;
	sha256: string;
};

export type MaterializedKnowledgeBundle = {
	bundlePath: string;
	bundleSha256: string;
	stagingDirectory: string;
	files: MaterializedKnowledgeFile[];
};

type ZipEntry = {
	name: string;
	method: number;
	compressedSize: number;
	uncompressedSize: number;
	localHeaderOffset: number;
};

const MIME_BY_EXTENSION: Record<string, string> = {
	".md": "text/markdown",
	".txt": "text/plain",
	".pdf": "application/pdf",
	".docx":
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	".json": "application/json",
	".csv": "text/csv",
	".yaml": "text/yaml",
	".yml": "text/yaml",
	".js": "text/javascript",
	".ts": "text/plain",
	".py": "text/plain",
};

function sha256(bytes: Uint8Array): string {
	return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function unsafeEntry(name: string): boolean {
	if (
		name.length === 0 ||
		name.includes("\\") ||
		name.includes("\0") ||
		name.startsWith("/") ||
		/^[a-zA-Z]:/.test(name)
	)
		return true;
	const parts = name.split("/");
	return parts.some((part) => part === "" || part === "." || part === "..");
}

function findEndOfCentralDirectory(buffer: Buffer): number {
	const minimum = Math.max(0, buffer.length - 65_557);
	for (let offset = buffer.length - 22; offset >= minimum; offset -= 1)
		if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
	throw new Error("KNOWLEDGE_ZIP_INVALID");
}

function parseEntries(buffer: Buffer, maxEntries: number): ZipEntry[] {
	const eocd = findEndOfCentralDirectory(buffer);
	const entries = buffer.readUInt16LE(eocd + 10);
	const centralSize = buffer.readUInt32LE(eocd + 12);
	const centralOffset = buffer.readUInt32LE(eocd + 16);
	if (
		entries === 0 ||
		entries > maxEntries ||
		centralOffset + centralSize > buffer.length
	)
		throw new Error("KNOWLEDGE_ZIP_INVALID");
	const result: ZipEntry[] = [];
	let offset = centralOffset;
	for (let index = 0; index < entries; index += 1) {
		if (
			offset + 46 > buffer.length ||
			buffer.readUInt32LE(offset) !== 0x02014b50
		)
			throw new Error("KNOWLEDGE_ZIP_INVALID");
		const flags = buffer.readUInt16LE(offset + 8);
		const method = buffer.readUInt16LE(offset + 10);
		const compressedSize = buffer.readUInt32LE(offset + 20);
		const uncompressedSize = buffer.readUInt32LE(offset + 24);
		const nameLength = buffer.readUInt16LE(offset + 28);
		const extraLength = buffer.readUInt16LE(offset + 30);
		const commentLength = buffer.readUInt16LE(offset + 32);
		const localHeaderOffset = buffer.readUInt32LE(offset + 42);
		const end = offset + 46 + nameLength + extraLength + commentLength;
		if (end > buffer.length || (flags & 0x1) !== 0)
			throw new Error("KNOWLEDGE_ZIP_INVALID");
		const name = buffer
			.subarray(offset + 46, offset + 46 + nameLength)
			.toString("utf8");
		result.push({
			name,
			method,
			compressedSize,
			uncompressedSize,
			localHeaderOffset,
		});
		offset = end;
	}
	return result;
}

function extractEntry(buffer: Buffer, entry: ZipEntry): Buffer {
	const offset = entry.localHeaderOffset;
	if (offset + 30 > buffer.length || buffer.readUInt32LE(offset) !== 0x04034b50)
		throw new Error("KNOWLEDGE_ZIP_INVALID");
	const nameLength = buffer.readUInt16LE(offset + 26);
	const extraLength = buffer.readUInt16LE(offset + 28);
	const dataOffset = offset + 30 + nameLength + extraLength;
	const dataEnd = dataOffset + entry.compressedSize;
	if (dataEnd > buffer.length) throw new Error("KNOWLEDGE_ZIP_INVALID");
	const compressed = buffer.subarray(dataOffset, dataEnd);
	const output =
		entry.method === 0
			? Buffer.from(compressed)
			: entry.method === 8
				? inflateRawSync(compressed)
				: (() => {
						throw new Error("KNOWLEDGE_ZIP_COMPRESSION_UNSUPPORTED");
					})();
	if (output.length !== entry.uncompressedSize)
		throw new Error("KNOWLEDGE_ZIP_SIZE_MISMATCH");
	return output;
}

export async function materializeCustomGptKnowledgeBundle(input: {
	bundlePath: string;
	stagingRoot: string;
	maxEntries?: number;
	maxEntryBytes?: number;
	maxTotalBytes?: number;
}): Promise<MaterializedKnowledgeBundle> {
	const maxEntries = input.maxEntries ?? 64;
	const maxEntryBytes = input.maxEntryBytes ?? 32 * 1024 * 1024;
	const maxTotalBytes = input.maxTotalBytes ?? 128 * 1024 * 1024;
	const bundlePath = resolve(input.bundlePath);
	const archive = await readFile(bundlePath);
	const bundleSha256 = sha256(archive);
	const entries = parseEntries(archive, maxEntries);
	let totalBytes = 0;
	let knowledgeEntryCount = 0;
	for (const entry of entries) {
		if (entry.name.endsWith("/")) continue;
		if (unsafeEntry(entry.name)) throw new Error("KNOWLEDGE_ZIP_ENTRY_UNSAFE");
		if (entry.uncompressedSize > maxEntryBytes)
			throw new Error("KNOWLEDGE_ZIP_ENTRY_TOO_LARGE");
		totalBytes += entry.uncompressedSize;
		if (totalBytes > maxTotalBytes)
			throw new Error("KNOWLEDGE_ZIP_TOTAL_TOO_LARGE");
		if (!MIME_BY_EXTENSION[extname(entry.name).toLowerCase()])
			throw new Error("KNOWLEDGE_FILE_TYPE_UNSUPPORTED");
		extractEntry(archive, entry);
		knowledgeEntryCount += 1;
	}
	if (knowledgeEntryCount === 0) throw new Error("KNOWLEDGE_ZIP_EMPTY");
	const stagingDirectory = join(
		resolve(input.stagingRoot),
		bundleSha256.slice("sha256:".length, "sha256:".length + 24),
	);
	await rm(stagingDirectory, { recursive: true, force: true });
	await mkdir(stagingDirectory, { recursive: true, mode: 0o700 });
	const fileName = basename(bundlePath);
	const stagedBundlePath = join(stagingDirectory, fileName);
	await writeFile(stagedBundlePath, archive, { mode: 0o600 });
	return {
		bundlePath,
		bundleSha256,
		stagingDirectory,
		files: [
			{
				name: fileName,
				relativePath: fileName,
				path: stagedBundlePath,
				mime: "application/zip",
				sizeBytes: archive.length,
				sha256: bundleSha256,
			},
		],
	};
}

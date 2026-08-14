import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
	detectedExternalMime,
	ExternalFileMaterializationError,
	externalMimeCompatible,
	materializeExternalFiles,
} from "../src/index.ts";

function input(overrides: Record<string, unknown> = {}) {
	return {
		name: "spec.txt",
		provenanceRef: "file:abc",
		declaredMimeType: "text/plain",
		sourceUrl: "https://files.example/spec.txt",
		...overrides,
	};
}

function rejectsWithCode(code: string) {
	return (error: unknown) => {
		assert.ok(
			error instanceof ExternalFileMaterializationError,
			`expected ExternalFileMaterializationError, got ${String(error)}`,
		);
		assert.equal(error.code, code);
		return true;
	};
}

test("B2-GW-01 detectedExternalMime distinguishes binary magic bytes from plain text", () => {
	assert.equal(
		detectedExternalMime(Buffer.from("%PDF-1.7 rest of body")),
		"application/pdf",
	);
	assert.equal(
		detectedExternalMime(
			Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]),
		),
		"image/png",
	);
	assert.equal(
		detectedExternalMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])),
		"image/jpeg",
	);
	assert.equal(
		detectedExternalMime(Buffer.from("GIF89a trailer")),
		"image/gif",
	);
	assert.equal(
		detectedExternalMime(Buffer.from("GIF87a trailer")),
		"image/gif",
	);
	assert.equal(
		detectedExternalMime(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00])),
		"application/zip",
	);
	assert.equal(
		detectedExternalMime(Buffer.from("plain utf-8 text")),
		"text/plain",
	);
	assert.equal(
		detectedExternalMime(Buffer.from([0x00, 0x01, 0x02, 0xff])),
		"application/octet-stream",
	);
});

test("B2-GW-01 externalMimeCompatible fails closed on declared/detected/response mismatch", () => {
	// Text content accepted when declared as text-ish and the response is compatible.
	assert.equal(
		externalMimeCompatible("text/plain", "text/plain", "text/plain"),
		true,
	);
	assert.equal(externalMimeCompatible("text/plain", null, "text/plain"), true);
	assert.equal(
		externalMimeCompatible(
			"text/plain",
			"application/octet-stream",
			"text/plain",
		),
		true,
	);
	assert.equal(
		externalMimeCompatible(
			"application/json",
			"application/json",
			"text/plain",
		),
		true,
	);
	// Declared parameters are normalized away before comparison.
	assert.equal(
		externalMimeCompatible(
			"text/plain; charset=utf-8",
			"text/plain",
			"text/plain",
		),
		true,
	);
	// Text declaration against detected binary bytes is rejected.
	assert.equal(
		externalMimeCompatible("text/plain", "text/plain", "application/pdf"),
		false,
	);
	// Binary declaration is accepted only when detected bytes match exactly.
	assert.equal(
		externalMimeCompatible("application/pdf", null, "application/pdf"),
		true,
	);
	assert.equal(
		externalMimeCompatible(
			"application/pdf",
			"application/octet-stream",
			"application/pdf",
		),
		true,
	);
	assert.equal(
		externalMimeCompatible("application/pdf", null, "image/png"),
		false,
	);
	// A binary declaration matching the bytes still rejects a conflicting response type.
	assert.equal(
		externalMimeCompatible("application/pdf", "text/html", "application/pdf"),
		false,
	);
});

test("B2-GW-01 materializeExternalFiles fails closed on unsafe URL, filename, and count", async () => {
	const artifactRoot = await mkdtemp(
		join(tmpdir(), "proflow-execution-local-file-bridge-"),
	);
	await assert.rejects(
		() => materializeExternalFiles({ artifactRoot, files: [] }),
		rejectsWithCode("EXTERNAL_FILE_COUNT_EXCEEDED"),
	);
	await assert.rejects(
		() =>
			materializeExternalFiles({
				artifactRoot,
				files: Array.from({ length: 11 }, (_, index) =>
					input({
						name: `f${index}.txt`,
						provenanceRef: `file:${index}`,
						sourceUrl: `https://files.example/${index}`,
					}),
				),
			}),
		rejectsWithCode("EXTERNAL_FILE_COUNT_EXCEEDED"),
	);
	// Non-HTTPS and credential-bearing URLs are rejected before any DNS or fetch.
	await assert.rejects(
		() =>
			materializeExternalFiles({
				artifactRoot,
				files: [input({ sourceUrl: "http://files.example/spec.txt" })],
			}),
		rejectsWithCode("EXTERNAL_FILE_INPUT_INVALID"),
	);
	await assert.rejects(
		() =>
			materializeExternalFiles({
				artifactRoot,
				files: [
					input({ sourceUrl: "https://user:pass@files.example/spec.txt" }),
				],
			}),
		rejectsWithCode("EXTERNAL_FILE_INPUT_INVALID"),
	);
	// Loopback, metadata, and every private/link-local literal IP is rejected after
	// DNS resolution, so no physical fetch can target an internal address.
	for (const sourceUrl of [
		"https://localhost/spec.txt",
		"https://metadata.google.internal/spec.txt",
		"https://127.0.0.1/spec.txt",
		"https://10.0.0.1/spec.txt",
		"https://172.16.0.1/spec.txt",
		"https://192.168.1.1/spec.txt",
		"https://169.254.169.254/latest/meta-data",
		"https://100.64.0.1/spec.txt",
	]) {
		await assert.rejects(
			() =>
				materializeExternalFiles({
					artifactRoot,
					files: [input({ sourceUrl })],
				}),
			rejectsWithCode("EXTERNAL_FILE_INPUT_INVALID"),
			sourceUrl,
		);
	}
	// Path-traversing filenames are rejected before any URL validation or fetch.
	await assert.rejects(
		() =>
			materializeExternalFiles({
				artifactRoot,
				files: [input({ name: "../secret" })],
			}),
		rejectsWithCode("EXTERNAL_FILE_INPUT_INVALID"),
	);
	await assert.rejects(
		() =>
			materializeExternalFiles({
				artifactRoot,
				files: [input({ name: "a/b" })],
			}),
		rejectsWithCode("EXTERNAL_FILE_INPUT_INVALID"),
	);
	// Missing provenance or declared MIME type is rejected as invalid input.
	await assert.rejects(
		() =>
			materializeExternalFiles({
				artifactRoot,
				files: [input({ provenanceRef: "" })],
			}),
		rejectsWithCode("EXTERNAL_FILE_INPUT_INVALID"),
	);
	await assert.rejects(
		() =>
			materializeExternalFiles({
				artifactRoot,
				files: [input({ declaredMimeType: "" })],
			}),
		rejectsWithCode("EXTERNAL_FILE_INPUT_INVALID"),
	);
});

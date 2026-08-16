import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
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

type LocalHandler = (
	request: import("node:http").IncomingMessage,
	response: import("node:http").ServerResponse,
) => void;

async function listen(handler: LocalHandler) {
	const server = createServer(handler);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("no port");
	return {
		baseUrl: `http://127.0.0.1:${address.port}`,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}

const publicDns = async (): Promise<Array<{ address: string; family: number }>> => [
	{ address: "8.8.8.8", family: 4 },
];

function localFetch(baseUrl: string): typeof fetch {
	return async (input, init) => {
		const url = input instanceof URL ? input : new URL(String(input));
		return fetch(new URL(url.pathname + url.search, baseUrl), init);
	};
}

test("PRESMOKE-B6-FILE-01 remote materialization streams, hashes, detects MIME and inlines only small text", async () => {
	const artifactRoot = await mkdtemp(join(tmpdir(), "proflow-file-bridge-ok-"));
	const { baseUrl, close } = await listen((request, response) => {
		response.setHeader("content-type", "text/plain");
		response.end("hello external world");
	});
	try {
		const [result] = await materializeExternalFiles({
			artifactRoot,
			fetchImpl: localFetch(baseUrl),
			resolveDns: publicDns,
			files: [
				input({ sourceUrl: "https://files.example/ok.txt" }),
			],
		});
		assert.ok(result);
		assert.equal(result.detectedMimeType, "text/plain");
		assert.equal(result.bytes, Buffer.byteLength("hello external world"));
		assert.equal(result.content, "hello external world");
		assert.match(result.hash, /^sha256:/);
		assert.match(result.artifactRef, /^artifact:/);
	} finally {
		await close();
	}
});

test("PRESMOKE-B6-FILE-02 large text is not retained in memory (inline budget)", async () => {
	const artifactRoot = await mkdtemp(join(tmpdir(), "proflow-file-bridge-large-"));
	const large = "x".repeat(300_000);
	const { baseUrl, close } = await listen((request, response) => {
		response.setHeader("content-type", "text/plain");
		response.end(large);
	});
	try {
		const [result] = await materializeExternalFiles({
			artifactRoot,
			fetchImpl: localFetch(baseUrl),
			resolveDns: publicDns,
			files: [input({ sourceUrl: "https://files.example/large.txt" })],
		});
		assert.ok(result);
		assert.equal(result.bytes, 300_000);
		assert.equal("content" in result, false);
	} finally {
		await close();
	}
});

test("PRESMOKE-B6-FILE-03 redirect hop follows, unsafe hop rejects, hop limit fails", async () => {
	const artifactRoot = await mkdtemp(join(tmpdir(), "proflow-file-bridge-redir-"));
	const redirecting = await listen((request, response) => {
		if (request.url === "/hop") {
			response.statusCode = 302;
			response.setHeader("location", "https://files.example/final.txt");
			response.end();
			return;
		}
		if (request.url === "/to-private") {
			response.statusCode = 302;
			response.setHeader("location", "https://private.example/final.txt");
			response.end();
			return;
		}
		if (request.url === "/loop") {
			response.statusCode = 302;
			response.setHeader("location", "https://files.example/loop");
			response.end();
			return;
		}
		response.setHeader("content-type", "text/plain");
		response.end("redirected");
	});
	const dns = async (hostname: string) =>
		hostname === "private.example"
			? [{ address: "192.168.1.10", family: 4 }]
			: [{ address: "8.8.8.8", family: 4 }];
	try {
		const [followed] = await materializeExternalFiles({
			artifactRoot,
			fetchImpl: localFetch(redirecting.baseUrl),
			resolveDns: dns,
			files: [input({ sourceUrl: "https://files.example/hop" })],
		});
		assert.ok(followed);
		assert.equal(followed.content, "redirected");

		await assert.rejects(
			materializeExternalFiles({
				artifactRoot,
				fetchImpl: localFetch(redirecting.baseUrl),
				resolveDns: dns,
				files: [input({ sourceUrl: "https://files.example/to-private" })],
			}),
			rejectsWithCode("EXTERNAL_FILE_INPUT_INVALID"),
		);

		await assert.rejects(
			materializeExternalFiles({
				artifactRoot,
				fetchImpl: localFetch(redirecting.baseUrl),
				resolveDns: dns,
				files: [input({ sourceUrl: "https://files.example/loop" })],
			}),
			rejectsWithCode("EXTERNAL_FILE_FETCH_FAILED"),
		);
	} finally {
		await redirecting.close();
	}
});

test("PRESMOKE-B6-FILE-04 fetch timeout and HTTP failure classify distinctly", async () => {
	const artifactRoot = await mkdtemp(join(tmpdir(), "proflow-file-bridge-fail-"));
	const hanging = await listen(() => {
		/* never respond */
	});
	const failing = await listen((_request, response) => {
		response.statusCode = 503;
		response.end();
	});
	try {
		await assert.rejects(
			materializeExternalFiles({
				artifactRoot,
				fetchImpl: localFetch(hanging.baseUrl),
				resolveDns: publicDns,
				fetchTimeoutMs: 150,
				files: [input({ sourceUrl: "https://files.example/slow.txt" })],
			}),
			rejectsWithCode("EXTERNAL_FILE_FETCH_TIMEOUT"),
		);
		await assert.rejects(
			materializeExternalFiles({
				artifactRoot,
				fetchImpl: localFetch(failing.baseUrl),
				resolveDns: publicDns,
				files: [input({ sourceUrl: "https://files.example/fail.txt" })],
			}),
			rejectsWithCode("EXTERNAL_FILE_FETCH_FAILED"),
		);
	} finally {
		await hanging.close();
		await failing.close();
	}
});

test("PRESMOKE-B6-FILE-05 declared size overflow and MIME mismatch fail closed", async () => {
	const artifactRoot = await mkdtemp(join(tmpdir(), "proflow-file-bridge-meta-"));
	const oversized = await listen((_request, response) => {
		response.setHeader("content-type", "text/plain");
		response.setHeader("content-length", String(10_000_001));
		response.end("x".repeat(16));
	});
	const mismatched = await listen((_request, response) => {
		response.setHeader("content-type", "application/pdf");
		response.end("%PDF-1.4 fake");
	});
	try {
		await assert.rejects(
			materializeExternalFiles({
				artifactRoot,
				fetchImpl: localFetch(oversized.baseUrl),
				resolveDns: publicDns,
				files: [input({ sourceUrl: "https://files.example/big.txt" })],
			}),
			rejectsWithCode("EXTERNAL_FILE_TOO_LARGE"),
		);
		await assert.rejects(
			materializeExternalFiles({
				artifactRoot,
				fetchImpl: localFetch(mismatched.baseUrl),
				resolveDns: publicDns,
				files: [input({ sourceUrl: "https://files.example/mime.pdf" })],
			}),
			rejectsWithCode("EXTERNAL_FILE_MIME_MISMATCH"),
		);
	} finally {
		await oversized.close();
		await mismatched.close();
	}
});

import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { BrowserRealityBridgeError } from "./bridge-error.ts";

const jsonHeaders = {
	"content-type": "application/json; charset=utf-8",
	"cache-control": "no-store",
};

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringField(value: Record<string, unknown>, key: string): string {
	const item = value[key];
	if (typeof item !== "string" || item.length === 0)
		throw new BrowserRealityBridgeError(
			"BRIDGE_INPUT_INVALID",
			`${key} must be a non-empty string`,
		);
	return item;
}

export function numberField(value: Record<string, unknown>, key: string): number {
	const item = value[key];
	if (typeof item !== "number" || !Number.isFinite(item))
		throw new BrowserRealityBridgeError(
			"BRIDGE_INPUT_INVALID",
			`${key} must be a finite number`,
		);
	return item;
}

export function safeEqual(left: string, right: string): boolean {
	const leftBytes = Buffer.from(left);
	const rightBytes = Buffer.from(right);
	return (
		leftBytes.length === rightBytes.length &&
		timingSafeEqual(leftBytes, rightBytes)
	);
}

export async function readJson(request: IncomingMessage): Promise<unknown> {
	let body = "";
	for await (const chunk of request) {
		body += String(chunk);
		if (body.length > 100_000)
			throw new BrowserRealityBridgeError(
				"BRIDGE_INPUT_INVALID",
				"bridge body exceeds 100000 characters",
			);
	}
	try {
		return body.length === 0 ? {} : JSON.parse(body);
	} catch {
		throw new BrowserRealityBridgeError(
			"BRIDGE_INPUT_INVALID",
			"bridge body is not valid JSON",
		);
	}
}

export function send(
	response: ServerResponse,
	status: number,
	value?: unknown,
): void {
	response.writeHead(status, jsonHeaders);
	response.end(value === undefined ? "" : JSON.stringify(value));
}

export function sendText(
	response: ServerResponse,
	status: number,
	contentType: string,
	value: string,
): void {
	response.writeHead(status, {
		"content-type": contentType,
		"cache-control": "no-store",
		"content-security-policy":
			"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:",
		"x-content-type-options": "nosniff",
		"referrer-policy": "no-referrer",
	});
	response.end(value);
}

export function cookieValue(
	request: IncomingMessage,
	name: string,
): string | undefined {
	for (const part of (request.headers.cookie ?? "").split(";")) {
		const [key, ...rest] = part.trim().split("=");
		if (key === name) return rest.join("=");
	}
	return undefined;
}

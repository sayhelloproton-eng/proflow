import { BrowserRealityBridgeError } from "./bridge-error.ts";
import { isRecord, numberField, stringField } from "./bridge-http.ts";
import { createBrowserPort, type BridgeCommandInput } from "./bridge-protocol.ts";

export function createBrowserRealityBridgeClient(options: {
	endpoint: string;
	token: string;
}) {
	const endpoint = new URL(options.endpoint);
	if (
		endpoint.protocol !== "http:" ||
		endpoint.hostname !== "127.0.0.1" ||
		endpoint.pathname !== "/" ||
		endpoint.search ||
		endpoint.hash ||
		endpoint.username ||
		endpoint.password ||
		options.token.length < 32
	)
		throw new TypeError(
			"bridge client requires loopback HTTP root and executor credential",
		);
	const abort = new AbortController();
	const offline = () => ({
		online: false,
		extensionInstanceId: null as string | null,
		queuedCommands: 0,
		pendingCommands: 0,
	});
	let snapshot = offline();

	async function call(
		path: string,
		command?: BridgeCommandInput,
	): Promise<unknown> {
		const response = await fetch(new URL(path, endpoint), {
			method: command ? "POST" : "GET",
			headers: {
				authorization: `Bearer ${options.token}`,
				"content-type": "application/json",
			},
			...(command ? { body: JSON.stringify(command) } : {}),
			signal: AbortSignal.any([
				abort.signal,
				AbortSignal.timeout(command ? 125_000 : 2_000),
			]),
		});
		const body: unknown = await response.json();
		if (!response.ok)
			throw new BrowserRealityBridgeError(
				"BRIDGE_COMMAND_FAILED",
				isRecord(body) && typeof body.error === "string"
					? body.error
					: "bridge transport failed",
			);
		return body;
	}

	return Object.freeze({
		browser: createBrowserPort(async (command) => {
			const body = await call("/v1/executor/commands", command);
			if (!isRecord(body))
				throw new TypeError("bridge response must be an object");
			return body.value;
		}),
		status: () => snapshot,
		async refreshStatus() {
			try {
				const body = await call("/v1/executor/status");
				if (!isRecord(body) || typeof body.online !== "boolean")
					throw new TypeError("bridge status is invalid");
				snapshot = {
					online: body.online,
					extensionInstanceId:
						body.extensionInstanceId === null
							? null
							: stringField(body, "extensionInstanceId"),
					queuedCommands: numberField(body, "queuedCommands"),
					pendingCommands: numberField(body, "pendingCommands"),
				};
			} catch {
				snapshot = offline();
			}
			return snapshot;
		},
		async close() {
			abort.abort();
			snapshot = offline();
		},
	});
}

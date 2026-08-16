import { createHash, timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { createAgentGateway } from "./index.ts";

export type AgentGatewayProcessConfig = {
	host: string;
	port: number;
	publicBaseUrl: string;
	downstreamBaseUrl: string;
	credentialFile: string;
	downstreamCredentialFile?: string;
};

function record(value: unknown, name: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new TypeError(`${name} must be an object`);
	return value as Record<string, unknown>;
}
function text(value: unknown, name: string): string {
	if (typeof value !== "string" || value.length === 0)
		throw new TypeError(`${name} must be a non-empty string`);
	return value;
}
export function parseAgentGatewayProcessConfig(
	value: unknown,
): AgentGatewayProcessConfig {
	const input = record(value, "agent-gateway config");
	const publicBaseUrl = new URL(text(input.publicBaseUrl, "publicBaseUrl"));
	if (publicBaseUrl.protocol !== "https:")
		throw new TypeError("publicBaseUrl must be HTTPS");
	const downstreamBaseUrl = new URL(
		text(input.downstreamBaseUrl, "downstreamBaseUrl"),
	);
	if (
		downstreamBaseUrl.protocol !== "http:" ||
		!["localhost", "127.0.0.1", "::1"].includes(downstreamBaseUrl.hostname)
	)
		throw new TypeError("downstreamBaseUrl must be loopback HTTP");
	const port = input.port === undefined ? 0 : Number(input.port);
	if (!Number.isInteger(port) || port < 0 || port > 65_535)
		throw new TypeError("port must be an integer from 0 through 65535");
	return {
		host: input.host === undefined ? "127.0.0.1" : text(input.host, "host"),
		port,
		publicBaseUrl: publicBaseUrl.href.replace(/\/$/, ""),
		downstreamBaseUrl: downstreamBaseUrl.href.replace(/\/$/, ""),
		credentialFile: resolve(text(input.credentialFile, "credentialFile")),
		...(input.downstreamCredentialFile === undefined
			? {}
			: {
					downstreamCredentialFile: resolve(
						text(input.downstreamCredentialFile, "downstreamCredentialFile"),
					),
				}),
	};
}

export async function loadAgentGatewayProcessConfig(path: string) {
	return parseAgentGatewayProcessConfig(
		JSON.parse(await readFile(resolve(path), "utf8")),
	);
}

function sameSecret(left: string, right: string): boolean {
	const a = createHash("sha256").update(left).digest();
	const b = createHash("sha256").update(right).digest();
	return timingSafeEqual(a, b);
}

function parseCredentialStore(value: unknown): Record<string, string> {
	const store = record(value, "credential store");
	const credentials: Record<string, string> = {};
	for (const [roleRef, credential] of Object.entries(store)) {
		if (
			roleRef.length === 0 ||
			typeof credential !== "string" ||
			credential.length < 16
		)
			throw new TypeError(
				"credential store contains an invalid role credential",
			);
		credentials[roleRef] = credential;
	}
	return credentials;
}

async function readCurrentCredentialStore(file: string) {
	return parseCredentialStore(JSON.parse(await readFile(file, "utf8")));
}

async function readDownstreamCredential(file: string) {
	const info = await stat(file);
	if (process.platform !== "win32" && (info.mode & 0o077) !== 0)
		throw new Error("DOWNSTREAM_TRANSPORT_CREDENTIAL_PERMISSIONS_INVALID");
	const credential = (await readFile(file, "utf8")).trim();
	if (credential.length < 32)
		throw new Error("DOWNSTREAM_TRANSPORT_CREDENTIAL_INVALID");
	return credential;
}

export async function createAgentGatewayProcess(input: {
	config: AgentGatewayProcessConfig;
	fetch?: typeof globalThis.fetch;
	log?: (entry: Record<string, unknown>) => void;
}) {
	const fetchImplementation = input.fetch ?? globalThis.fetch;
	const credentialFile = input.config.credentialFile;
	// Fail-fast at startup so a malformed configured credential store is rejected
	// before the process advertises readiness. Authentication re-reads the current
	// store on every attempt below, so a rotated key takes effect without a restart
	// and a malformed/half-written store fails closed instead of serving a stale
	// snapshot.
	await readCurrentCredentialStore(credentialFile);
	if (input.config.downstreamCredentialFile)
		await readDownstreamCredential(input.config.downstreamCredentialFile);
	const credentialAuthority = async (): Promise<boolean> => {
		try {
			return (
				Object.keys(await readCurrentCredentialStore(credentialFile)).length > 0
			);
		} catch {
			return false;
		}
	};
	const downstream = async (
		path: string,
		body?: unknown,
		signal?: AbortSignal,
	) => {
		const downstreamCredential = input.config.downstreamCredentialFile
			? await readDownstreamCredential(input.config.downstreamCredentialFile)
			: undefined;
		const response = await fetchImplementation(
			`${input.config.downstreamBaseUrl}${path}`,
			{
				method: body === undefined ? "GET" : "POST",
				headers: {
					...(body === undefined ? {} : { "content-type": "application/json" }),
					...(downstreamCredential
						? { authorization: `Bearer ${downstreamCredential}` }
						: {}),
				},
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
				...(signal ? { signal } : {}),
			},
		);
		if (!response.ok)
			throw Object.assign(new Error("DOWNSTREAM_UNAVAILABLE"), {
				httpStatus: response.status,
			});
		return response.json();
	};
	const gateway = await createAgentGateway({
		host: input.config.host,
		port: input.config.port,
		relayBaseUrl: `${input.config.publicBaseUrl}/relay/`,
		owners: {
			async authenticateBearer(credential) {
				const credentials = await readCurrentCredentialStore(credentialFile);
				for (const [roleRef, stored] of Object.entries(credentials))
					if (sameSecret(credential, String(stored))) return roleRef;
				throw new Error("AUTHENTICATION_FAILED");
			},
			route(operationId, authenticatedRoleRef, value, context) {
				return downstream(
					`/actions/${encodeURIComponent(operationId)}`,
					{
						authenticatedRoleRef,
						input: value,
						...(context?.fileMaterializationInputs === undefined
							? {}
							: {
									fileMaterializationInputs: context.fileMaterializationInputs,
								}),
					},
					context?.signal,
				);
			},
			lookupResult(operationId, authenticatedRoleRef, value) {
				return downstream(
					`/actions/${encodeURIComponent(operationId)}/result`,
					{
						authenticatedRoleRef,
						input: value,
					},
				);
			},
			async readiness() {
				try {
					const downstreamCredential = input.config.downstreamCredentialFile
						? await readDownstreamCredential(
								input.config.downstreamCredentialFile,
							)
						: undefined;
					const response = await fetchImplementation(
						`${input.config.downstreamBaseUrl}/ready`,
						{
							headers: downstreamCredential
								? { authorization: `Bearer ${downstreamCredential}` }
								: {},
							signal: AbortSignal.timeout(2_000),
						},
					);
					return {
						credentialStore: await credentialAuthority(),
						downstream: response.ok,
					};
				} catch {
					return {
						credentialStore: await credentialAuthority(),
						downstream: false,
					};
				}
			},
		},
	});
	const start = async () => {
		const address = await gateway.start();
		input.log?.({
			timestamp: new Date().toISOString(),
			component: "agent-gateway-process",
			event: "SERVICE_STARTED",
			...address,
		});
		return address;
	};
	const stop = async () => {
		await gateway.stop();
		input.log?.({
			timestamp: new Date().toISOString(),
			component: "agent-gateway-process",
			event: "SERVICE_STOPPED",
		});
	};
	return Object.freeze({
		...gateway,
		start,
		stop,
		async restart() {
			await stop();
			return start();
		},
	});
}

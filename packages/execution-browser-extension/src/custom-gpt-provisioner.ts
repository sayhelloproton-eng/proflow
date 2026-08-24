import { readFile, rm } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { readModuleSharedFacts } from "@tomflow/proflow-module-contract";
import type { CustomGptProvisioningRequest } from "./custom-gpt-editor-driver.ts";
import {
	type MaterializedKnowledgeFile,
	materializeCustomGptKnowledgeBundle,
} from "./custom-gpt-knowledge.ts";
import {
	type CustomGptProvisioningBridgeOptions,
	createCustomGptProvisioningBridgeServer,
} from "./provisioning-bridge.ts";

export type CustomGptPackageProvisioningMaterial = Omit<
	CustomGptProvisioningRequest,
	"actionSchema" | "knowledgeFiles" | "bearerCredential"
> & {
	actionSchema: string;
};

export type CustomGptProvisioningHostOptions =
	CustomGptProvisioningBridgeOptions & { onlineTimeoutMs?: number };

export type CustomGptProvisioningResult = {
	status: "LIVE_CREATED";
	packageName: string;
	version: string;
	gptId: string;
	carrierUrl: string;
	knowledgeBundleSha256: string;
	knowledgeFiles: Array<{
		name: string;
		mime: string;
		sizeBytes: number;
		sha256: string;
	}>;
};

function packageAsset(
	packageRoot: string,
	asset: string,
	name: string,
): string {
	if (asset.length === 0 || isAbsolute(asset))
		throw new Error(`${name}_INVALID`);
	const root = resolve(packageRoot);
	const path = resolve(root, asset);
	const rel = relative(root, path);
	if (
		rel === "" ||
		rel === ".." ||
		rel.startsWith(`..${sep}`) ||
		isAbsolute(rel)
	)
		throw new Error(`${name}_OUTSIDE_PACKAGE`);
	return path;
}

function publicGatewayUrl(value: string): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error("GATEWAY_URL_INVALID");
	}
	if (
		url.protocol !== "https:" ||
		url.username !== "" ||
		url.password !== "" ||
		url.search !== "" ||
		url.hash !== ""
	)
		throw new Error("GATEWAY_URL_INVALID");
	return url.toString().replace(/\/$/, "");
}

function hydratedSchema(schema: string, gatewayUrl: string): string {
	const gateway = publicGatewayUrl(gatewayUrl);
	if (schema.includes("https://GATEWAY_PUBLIC_HOST"))
		return schema.replaceAll("https://GATEWAY_PUBLIC_HOST", gateway);
	if (!schema.includes(gateway))
		throw new Error("ACTION_SCHEMA_GATEWAY_MISMATCH");
	return schema;
}

function fileEvidence(files: readonly MaterializedKnowledgeFile[]) {
	return files.map(({ name, mime, sizeBytes, sha256 }) => ({
		name,
		mime,
		sizeBytes,
		sha256,
	}));
}

function liveResult(
	value: unknown,
	material: CustomGptPackageProvisioningMaterial,
): Omit<
	CustomGptProvisioningResult,
	"knowledgeBundleSha256" | "knowledgeFiles"
> {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error("PROVISIONING_RESULT_INVALID");
	const result = value as Record<string, unknown>;
	if (
		result.status !== "LIVE_CREATED" ||
		result.packageName !== material.packageName ||
		result.version !== material.version ||
		typeof result.gptId !== "string" ||
		!/^g-[A-Za-z0-9_-]+$/.test(result.gptId) ||
		typeof result.carrierUrl !== "string"
	)
		throw new Error("PROVISIONING_RESULT_INVALID");
	const expected = `https://chatgpt.com/g/${result.gptId}`;
	if (result.carrierUrl !== expected)
		throw new Error("PROVISIONING_RESULT_INVALID");
	return {
		status: "LIVE_CREATED",
		packageName: material.packageName,
		version: material.version,
		gptId: result.gptId,
		carrierUrl: result.carrierUrl,
	};
}

function carrierGptId(carrierUrl: string): string {
	const url = new URL(carrierUrl);
	const match = /^\/g\/(g-[A-Za-z0-9_-]+)$/.exec(url.pathname);
	if (
		url.origin !== "https://chatgpt.com" ||
		url.username !== "" ||
		url.password !== "" ||
		url.search !== "" ||
		url.hash !== "" ||
		!match?.[1]
	)
		throw new Error("PROVISIONING_CARRIER_URL_INVALID");
	return match[1];
}

function authResult(value: unknown, carrierUrl: string) {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error("PROVISIONING_AUTH_RESULT_INVALID");
	const result = value as Record<string, unknown>;
	const expectedGptId = carrierGptId(carrierUrl);
	if (result.status !== "AUTH_UPDATED" || result.gptId !== expectedGptId)
		throw new Error("PROVISIONING_AUTH_RESULT_INVALID");
	return { status: "AUTH_UPDATED" as const, gptId: expectedGptId, carrierUrl };
}

const sleep = (milliseconds: number) =>
	new Promise<void>((resolveWait) => setTimeout(resolveWait, milliseconds));

export async function createCustomGptProvisioningHost(
	options: CustomGptProvisioningHostOptions,
) {
	const bridge = await createCustomGptProvisioningBridgeServer(options);
	const onlineTimeoutMs = options.onlineTimeoutMs ?? 30_000;

	async function waitUntilOnline(): Promise<void> {
		const deadline = Date.now() + onlineTimeoutMs;
		while (Date.now() < deadline) {
			if (bridge.status().online) return;
			await sleep(100);
		}
		throw new Error("PROVISIONING_EXTENSION_OFFLINE");
	}
	async function provisionPackage(input: {
		packageRoot: string;
		stagingRoot: string;
		gatewayUrl: string;
		material: CustomGptPackageProvisioningMaterial;
		credential?: string;
	}): Promise<CustomGptProvisioningResult> {
		await waitUntilOnline();
		if (input.credential !== undefined && input.credential.length < 32)
			throw new Error("PROVISIONING_ROLE_CREDENTIAL_INVALID");
		const schemaPath = packageAsset(
			input.packageRoot,
			input.material.actionSchema,
			"ACTION_SCHEMA_PATH",
		);
		const bundlePath = packageAsset(
			input.packageRoot,
			input.material.knowledgeBundle,
			"KNOWLEDGE_BUNDLE_PATH",
		);
		const schema = hydratedSchema(
			await readFile(schemaPath, "utf8"),
			input.gatewayUrl,
		);
		const bundle = await materializeCustomGptKnowledgeBundle({
			bundlePath,
			stagingRoot: input.stagingRoot,
		});
		try {
			const relayFiles = await bridge.provisioning.registerFiles(
				bundle.files.map((file) => ({
					name: file.name,
					path: file.path,
					mime: file.mime,
				})),
			);
			const request = {
				...input.material,
				actionSchema: schema,
				...(input.credential === undefined
					? {}
					: { bearerCredential: input.credential }),
				knowledgeFiles: relayFiles.map(
					({ name, mime, sizeBytes, sha256, url }) => ({
						name,
						mime,
						sizeBytes,
						sha256,
						url,
					}),
				),
			};
			if (JSON.stringify(request).length >= 100_000)
				throw new Error("PROVISIONING_REQUEST_BUDGET_EXCEEDED");
			const value = await bridge.provisioning.request({
				type: "PROVISION_CUSTOM_GPT",
				request,
			});
			return {
				...liveResult(value, input.material),
				knowledgeBundleSha256: bundle.bundleSha256,
				knowledgeFiles: fileEvidence(bundle.files),
			};
		} finally {
			await rm(bundle.stagingDirectory, { recursive: true, force: true });
		}
	}

	async function finalizeRoleAuth(input: {
		carrierUrl: string;
		credential: string;
	}) {
		await waitUntilOnline();
		carrierGptId(input.carrierUrl);
		if (input.credential.length < 32)
			throw new Error("PROVISIONING_ROLE_CREDENTIAL_INVALID");
		let credential = input.credential;
		try {
			const value = await bridge.provisioning.request({
				type: "FINALIZE_CUSTOM_GPT_AUTH",
				request: { carrierUrl: input.carrierUrl, credential },
			});
			return authResult(value, input.carrierUrl);
		} finally {
			credential = "";
		}
	}

	return Object.freeze({
		endpoint: bridge.endpoint,
		status: bridge.status,
		provisionPackage,
		finalizeRoleAuth,
		close: bridge.close,
	});
}

function sharedFactString(
	facts: Record<string, unknown> | undefined,
	name: string,
): string {
	const value = facts?.[name];
	if (typeof value !== "string" || value.length === 0)
		throw new Error(`PROVISIONING_SHARED_FACT_MISSING:${name}`);
	return value;
}

export async function createWorkspaceCustomGptProvisioningHost(input: {
	workspaceRoot: string;
	commandTimeoutMs?: number;
	onlineTimeoutMs?: number;
}) {
	const moduleRef = "execution-browser-extension";
	const facts = await readModuleSharedFacts(
		{ workspaceRoot: input.workspaceRoot },
		moduleRef,
	);
	const extensionId = sharedFactString(facts, "extensionId");
	if (!/^[a-z]{32}$/.test(extensionId))
		throw new Error("PROVISIONING_EXTENSION_ID_INVALID");
	const tokenFile = sharedFactString(facts, "provisioningBridgeTokenFile");
	const endpointText = sharedFactString(facts, "provisioningBridgeEndpoint");
	let endpoint: URL;
	try {
		endpoint = new URL(endpointText);
	} catch {
		throw new Error("PROVISIONING_ENDPOINT_INVALID");
	}
	const port = Number(endpoint.port);
	if (
		endpoint.protocol !== "http:" ||
		endpoint.hostname !== "127.0.0.1" ||
		endpoint.pathname !== "/" ||
		endpoint.search !== "" ||
		endpoint.hash !== "" ||
		!Number.isInteger(port) ||
		port <= 0 ||
		port > 65_535
	)
		throw new Error("PROVISIONING_ENDPOINT_INVALID");
	const token = (await readFile(tokenFile, "utf8")).trim();
	if (token.length < 32) throw new Error("PROVISIONING_TOKEN_INVALID");
	return createCustomGptProvisioningHost({
		token,
		extensionId,
		host: "127.0.0.1",
		port,
		...(input.commandTimeoutMs === undefined
			? {}
			: { commandTimeoutMs: input.commandTimeoutMs }),
		...(input.onlineTimeoutMs === undefined
			? {}
			: { onlineTimeoutMs: input.onlineTimeoutMs }),
	});
}

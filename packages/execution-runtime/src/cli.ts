#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises";
import {
	createBrowserExecutorComposition,
	loadBrowserExecutorCompositionConfig,
} from "@tomflow/proflow-execution-browser-extension/runtime-composition";
import { createExecutionModelDecisionClient } from "./model-decision-client.ts";
import {
	createExecutionRuntimeProcess,
	loadExecutionRuntimeProcessConfig,
} from "./service.ts";

async function readSecret(path: string, name: string) {
	const info = await stat(path);
	if (process.platform !== "win32" && (info.mode & 0o077) !== 0)
		throw new TypeError(`${name} permissions must be owner-only`);
	const value = (await readFile(path, "utf8")).trim();
	if (value.length < 32)
		throw new TypeError(`${name} must contain at least 32 characters`);
	return value;
}

async function createIdentityClient(config: {
	endpoint: string;
	tokenFile: string;
}) {
	const token = await readSecret(config.tokenFile, "execution identity token");
	let ready = false;
	const headers = { authorization: `Bearer ${token}` };
	try {
		ready = (
			await fetch(`${config.endpoint}/internal/execution/identity/ready`, {
				headers,
				signal: AbortSignal.timeout(2_000),
			})
		).ok;
	} catch {
		ready = false;
	}
	return {
		port: {
			async authorize(request: unknown) {
				try {
					const response = await fetch(
						`${config.endpoint}/internal/execution/authorize`,
						{
							method: "POST",
							headers: { ...headers, "content-type": "application/json" },
							body: JSON.stringify(request),
							signal: AbortSignal.timeout(5_000),
						},
					);
					ready = response.ok;
					if (!response.ok) return false;
					const body = (await response.json()) as { authorized?: unknown };
					return body.authorized === true;
				} catch {
					ready = false;
					return false;
				}
			},
		},
		readiness: () => ready,
	};
}

const [command, configPath] = process.argv.slice(2);
if (command !== "start" || !configPath)
	throw new Error(
		"Usage: proflow-execution-runtime start /absolute/config.json",
	);
const config = await loadExecutionRuntimeProcessConfig(configPath);
if (!config.identity)
	throw new Error("formal execution-runtime requires identity configuration");
if (!config.transportCredentialFile)
	throw new Error("formal execution-runtime requires transportCredentialFile");
if (!config.browserExecutorConfigPath)
	throw new Error(
		"formal execution-runtime requires browserExecutorConfigPath",
	);
if (!config.modelDecision)
	throw new Error(
		"formal execution-runtime requires modelDecision configuration",
	);
if (!config.modelDecision.credentialFile)
	throw new Error(
		"formal execution-runtime requires modelDecision.credentialFile",
	);
const identityClient = await createIdentityClient(config.identity);
const transportCredential = await readSecret(
	config.transportCredentialFile,
	"execution transport credential",
);
const modelDecisionCredential = await readSecret(
	config.modelDecision.credentialFile,
	"model decision transport credential",
);
const modelDecisionClient = createExecutionModelDecisionClient({
	endpoint: config.modelDecision.endpoint,
	...(config.modelDecision.timeoutMs === undefined
		? {}
		: { timeoutMs: config.modelDecision.timeoutMs }),
	credential: modelDecisionCredential,
});
await modelDecisionClient.probe();
const browserComposition = await createBrowserExecutorComposition(
	await loadBrowserExecutorCompositionConfig(config.browserExecutorConfigPath),
);
let service:
	| Awaited<ReturnType<typeof createExecutionRuntimeProcess>>
	| undefined;
try {
	service = await createExecutionRuntimeProcess({
		config,
		identity: identityClient.port,
		identityReadiness: identityClient.readiness,
		transportCredential,
		requireModelDecision: true,
		modelDecision: modelDecisionClient.port,
		modelDecisionReadiness: modelDecisionClient.readiness,
		browserExecutor: browserComposition.browserExecutor,
		browserReadiness: () => browserComposition.bridgeStatus().online,
		log: (entry) => process.stderr.write(`${JSON.stringify(entry)}\n`),
	});
	const address = await service.start();
	process.stdout.write(
		`${JSON.stringify({ status: "RUNNING", ...address, browserBridgeEndpoint: browserComposition.bridgeEndpoint })}\n`,
	);
} catch (error) {
	await browserComposition.close();
	throw error;
}
let stopping = false;
const stop = () => {
	if (stopping) return;
	stopping = true;
	void Promise.allSettled([
		service?.stop(),
		browserComposition.close(),
	]).finally(() => process.exit(0));
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
await new Promise(() => {});

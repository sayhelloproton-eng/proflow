import { readFile, stat } from "node:fs/promises";

import {
	createBrowserExecutorComposition,
	loadBrowserExecutorCompositionConfig,
} from "@tomflow/proflow-execution-browser-extension/runtime-composition";
import { createExecutionBrowserVisionClient } from "./browser-vision-client.ts";
import { createExecutionModelDecisionClient } from "./model-decision-client.ts";
import {
	createExecutionRuntimeProcess,
	type ExecutionRuntimeProcessConfig,
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

function assertFormalConfig(config: ExecutionRuntimeProcessConfig) {
	if (!config.identity)
		throw new Error("formal execution-runtime requires identity configuration");
	if (!config.transportCredentialFile)
		throw new Error(
			"formal execution-runtime requires transportCredentialFile",
		);
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
	return {
		identity: config.identity,
		transportCredentialFile: config.transportCredentialFile,
		browserExecutorConfigPath: config.browserExecutorConfigPath,
		modelDecision: {
			...config.modelDecision,
			credentialFile: config.modelDecision.credentialFile,
		},
	};
}

export function createFormalExecutionRuntimeLifecycle(input: {
	config: ExecutionRuntimeProcessConfig;
	log?: (entry: Record<string, unknown>) => void;
}) {
	const required = assertFormalConfig(input.config);
	let current:
		| {
				service: Awaited<ReturnType<typeof createExecutionRuntimeProcess>>;
				closeBrowser: () => Promise<void>;
				browserBridgeEndpoint: string;
		  }
		| undefined;

	const build = async () => {
		const identityClient = await createIdentityClient(required.identity);
		const transportCredential = await readSecret(
			required.transportCredentialFile,
			"execution transport credential",
		);
		const modelDecisionCredential = await readSecret(
			required.modelDecision.credentialFile,
			"model decision transport credential",
		);
		const modelDecisionClient = createExecutionModelDecisionClient({
			endpoint: required.modelDecision.endpoint,
			...(required.modelDecision.timeoutMs === undefined
				? {}
				: { timeoutMs: required.modelDecision.timeoutMs }),
			credential: modelDecisionCredential,
		});
		await modelDecisionClient.probe();
		const browserVisionClient = createExecutionBrowserVisionClient({
			endpoint: required.modelDecision.endpoint,
			...(required.modelDecision.timeoutMs === undefined
				? {}
				: { timeoutMs: required.modelDecision.timeoutMs }),
			credential: modelDecisionCredential,
		});
		const browserComposition = await createBrowserExecutorComposition({
			...(await loadBrowserExecutorCompositionConfig(
				required.browserExecutorConfigPath,
			)),
			vision: browserVisionClient.port,
		});
		try {
			const service = await createExecutionRuntimeProcess({
				config: input.config,
				identity: identityClient.port,
				identityReadiness: identityClient.readiness,
				transportCredential,
				requireModelDecision: true,
				modelDecision: modelDecisionClient.port,
				modelDecisionReadiness: modelDecisionClient.readiness,
				browserExecutor: browserComposition.browserExecutor,
				browserReadiness: () => browserComposition.bridgeStatus().online,
				carrierSummary: () => browserComposition.bridgeStatus(),
				...(input.log === undefined ? {} : { log: input.log }),
			});
			return {
				service,
				closeBrowser: () => browserComposition.close(),
				browserBridgeEndpoint: browserComposition.bridgeEndpoint,
			};
		} catch (error) {
			await browserComposition.close();
			throw error;
		}
	};

	return Object.freeze({
		status: () =>
			current?.service.status() ?? {
				readiness: "NOT_READY" as const,
			},
		async start() {
			if (current !== undefined)
				throw new Error(
					"formal execution-runtime lifecycle is already started",
				);
			current = await build();
			try {
				const address = await current.service.start();
				return {
					...address,
					browserBridgeEndpoint: current.browserBridgeEndpoint,
				};
			} catch (error) {
				await current.closeBrowser();
				current = undefined;
				throw error;
			}
		},
		async stop() {
			if (current === undefined) return;
			const closing = current;
			current = undefined;
			await Promise.allSettled([
				closing.service.stop(),
				closing.closeBrowser(),
			]);
		},
		async restart() {
			await this.stop();
			return this.start();
		},
	});
}

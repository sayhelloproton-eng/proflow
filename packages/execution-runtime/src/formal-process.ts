import { readFile, stat } from "node:fs/promises";

import { createBrowserExecutorClientComposition } from "@tomflow/proflow-execution-browser-extension/runtime-composition";
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
	const probe = async () => {
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
		return ready;
	};
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
		probe,
		readiness: () => ready,
	};
}

function assertFormalConfig(config: ExecutionRuntimeProcessConfig) {
	if (!config.transportCredentialFile)
		throw new Error(
			"formal execution-runtime requires transportCredentialFile",
		);
	if (!config.browserExecutorConfigPath)
		throw new Error(
			"formal execution-runtime requires browserExecutorConfigPath",
		);

	return {
		identity: config.identity,
		transportCredentialFile: config.transportCredentialFile,
		browserExecutorConfigPath: config.browserExecutorConfigPath,
	};
}

export function createFormalExecutionRuntimeLifecycle(input: {
	config: ExecutionRuntimeProcessConfig;
	log?: (entry: Record<string, unknown>) => void;
	resolveDependencies?: () => Promise<{
		identity?: ExecutionRuntimeProcessConfig["identity"];
		modelDecision?: ExecutionRuntimeProcessConfig["modelDecision"];
		platformHost?: { endpoint: string; tokenFile: string };
	}>;
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
		const dependencies =
			input.resolveDependencies ??
			(async () => ({
				identity: input.config.identity,
				modelDecision: input.config.modelDecision,
				platformHost: undefined,
			}));
		let identityReady = false;
		let modelReady = false;
		const resolveIdentity = async () => {
			const config = (await dependencies()).identity;
			if (!config) throw new Error("EXECUTION_IDENTITY_UNAVAILABLE");
			return createIdentityClient(config);
		};
		const modelConfig = async () => {
			const config = (await dependencies()).modelDecision;
			if (!config?.credentialFile)
				throw new Error("MODEL_DECISION_UNAVAILABLE");
			return {
				...config,
				credential: await readSecret(config.credentialFile, "model credential"),
			};
		};
		const transportCredential = await readSecret(
			required.transportCredentialFile,
			"execution transport credential",
		);
		const browserComposition = await createBrowserExecutorClientComposition({
			configPath: required.browserExecutorConfigPath,
			platformHost: async () => {
				const config = (await dependencies()).platformHost;
				if (!config) throw new Error("PLATFORM_HOST_APPLICATION_UNAVAILABLE");
				return {
					endpoint: config.endpoint,
					token: await readSecret(
						config.tokenFile,
						"task application credential",
					),
				};
			},
			vision: {
				inspect: async (request) =>
					createExecutionBrowserVisionClient(await modelConfig()).port.inspect(
						request,
					),
			},
		});
		let dependencyRefresh: Promise<void> | undefined;
		const refreshDependencies = () => {
			dependencyRefresh ??= Promise.allSettled([
				resolveIdentity()
					.then((client) => client.probe())
					.then((ready) => {
						identityReady = ready;
					})
					.catch(() => {
						identityReady = false;
					}),
				modelConfig()
					.then((config) => createExecutionModelDecisionClient(config).probe())
					.then((ready) => {
						modelReady = ready;
					})
					.catch(() => {
						modelReady = false;
					}),
				browserComposition.refreshStatus(),
			])
				.then(() => undefined)
				.finally(() => {
					dependencyRefresh = undefined;
				});
			return dependencyRefresh;
		};

		try {
			const service = await createExecutionRuntimeProcess({
				config: input.config,
				identity: {
					authorize: async (request) => {
						try {
							const client = await resolveIdentity();
							const allowed = await client.port.authorize(request);
							identityReady = client.readiness();
							return allowed;
						} catch {
							identityReady = false;
							return false;
						}
					},
				},
				identityReadiness: () => identityReady,
				transportCredential,
				requireModelDecision: true,
				modelDecision: {
					decide: async (request, context) => {
						const client = createExecutionModelDecisionClient(
							await modelConfig(),
						);
						await client.probe();
						modelReady = client.readiness();
						return client.port.decide(request, context);
					},
				},
				modelDecisionReadiness: () => modelReady,
				refreshDependencies,
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

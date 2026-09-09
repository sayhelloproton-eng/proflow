import { readFileSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
	deterministicLoopbackPort,
	ensureModuleSecretFile,
	type ModuleCommandContext,
	moduleWorkspaceStateDirectory,
	readModuleSharedFacts,
	writeModuleSharedFacts,
} from "@tomflow/proflow-module-contract";
import { descriptor } from "./descriptor.ts";

type Service = {
	start(): Promise<unknown>;
	stop(): Promise<void>;
	status(): { readiness: "READY" | "NOT_READY" };
};
const services = new Map<string, Service>();
const base = {
	contract: "deployment.result.v1",
	ok: true,
	status: "SUCCEEDED",
	moduleRef: descriptor.moduleRef,
	moduleVersion: descriptor.moduleVersion,
} as const;
const key = (context: ModuleCommandContext) => resolve(context.workspaceRoot);
const factString = (
	facts: Record<string, unknown> | undefined,
	name: string,
) => (typeof facts?.[name] === "string" ? String(facts[name]) : undefined);
async function ownFacts(context: ModuleCommandContext) {
	const state = moduleWorkspaceStateDirectory(context, descriptor.moduleRef);
	await mkdir(state, { recursive: true, mode: 0o700 });
	const facts = {
		endpoint: `http://127.0.0.1:${deterministicLoopbackPort(context, descriptor.moduleRef)}`,
		transportCredentialFile: await ensureModuleSecretFile(
			context,
			descriptor.moduleRef,
			"transport",
		),
		databasePath: join(state, "execution.sqlite"),
		projectRoot: key(context),
		artifactRoot: join(key(context), ".proflow", "artifacts", "execution"),
	};
	await mkdir(facts.artifactRoot, { recursive: true, mode: 0o700 });
	await writeModuleSharedFacts(context, descriptor.moduleRef, facts);
	return facts;
}
async function readOwnFacts(context: ModuleCommandContext) {
	const facts = await readModuleSharedFacts(context, descriptor.moduleRef);
	const endpoint = factString(facts, "endpoint");
	const transportCredentialFile = factString(facts, "transportCredentialFile");
	const databasePath = factString(facts, "databasePath");
	const projectRoot = factString(facts, "projectRoot");
	const artifactRoot = factString(facts, "artifactRoot");
	return endpoint &&
		transportCredentialFile &&
		databasePath &&
		projectRoot &&
		artifactRoot
		? {
				endpoint,
				transportCredentialFile,
				databasePath,
				projectRoot,
				artifactRoot,
			}
		: undefined;
}
async function startupDependencies(context: ModuleCommandContext) {
	const browser = await readModuleSharedFacts(
		context,
		"execution-browser-extension",
	);
	const browserExecutorConfigPath = factString(
		browser,
		"browserExecutorConfigPath",
	);
	return browserExecutorConfigPath ? { browserExecutorConfigPath } : undefined;
}
async function running(context: ModuleCommandContext) {
	const own = await readOwnFacts(context);
	if (!own) return false;
	try {
		const token = (await readFile(own.transportCredentialFile, "utf8")).trim();
		return (
			await fetch(`${own.endpoint}/ready`, {
				headers: { authorization: `Bearer ${token}` },
				signal: AbortSignal.timeout(500),
			})
		).ok;
	} catch {
		return false;
	}
}
async function compose(context: ModuleCommandContext): Promise<Service> {
	const own = await ownFacts(context);
	const browser = await readModuleSharedFacts(
		context,
		"execution-browser-extension",
	);
	const browserExecutorConfigPath = factString(
		browser,
		"browserExecutorConfigPath",
	);
	if (!browserExecutorConfigPath)
		throw new Error("Browser Executor shared facts are unavailable");

	const [
		{ createFormalExecutionRuntimeLifecycle },
		{ parseExecutionRuntimeProcessConfig },
	] = await Promise.all([
		import("../src/formal-process.ts"),
		import("../src/service.ts"),
	]);
	const url = new URL(own.endpoint);
	return createFormalExecutionRuntimeLifecycle({
		resolveDependencies: async () => {
			const host = await readModuleSharedFacts(context, "platform-host");
			const model = await readModuleSharedFacts(context, "model-runtime");
			const endpoint = factString(host, "endpoint"),
				tokenFile = factString(host, "identityTokenFile"),
				taskToken = factString(host, "taskApplicationTokenFile");
			const modelEndpoint = factString(model, "endpoint"),
				credentialFile = factString(model, "transportCredentialFile");
			return {
				...(endpoint && tokenFile ? { identity: { endpoint, tokenFile } } : {}),
				...(endpoint && taskToken
					? { platformHost: { endpoint, tokenFile: taskToken } }
					: {}),
				...(modelEndpoint && credentialFile
					? { modelDecision: { endpoint: modelEndpoint, credentialFile } }
					: {}),
			};
		},
		config: parseExecutionRuntimeProcessConfig({
			host: url.hostname,
			port: Number(url.port),
			databasePath: own.databasePath,
			projectRoot: own.projectRoot,
			artifactRoot: own.artifactRoot,
			browserExecutorConfigPath,
			transportCredentialFile: own.transportCredentialFile,
			exactNetworkTargets: [],
		}),
	});
}
const failed = (
	code: "SETUP_FAILED" | "START_FAILED" | "STOP_FAILED",
	message: string,
) => ({
	...base,
	ok: false as const,
	status: "FAILED" as const,
	error: { code, message, retryable: true },
});
export const behaviorAdapter = {
	install: async (context: ModuleCommandContext) => ({
		result: { ...base, data: await ownFacts(context) },
		observedEffects: [],
	}),
	uninstall: async (context: ModuleCommandContext) => {
		const service = services.get(key(context));
		if (service) {
			await service.stop();
			services.delete(key(context));
		}
		return {
			result: base,
			observedEffects: service
				? [...descriptor.effects.map((item) => item.description)]
				: [],
		};
	},
	status: async (context: ModuleCommandContext) => {
		const startup = await startupDependencies(context);
		return {
			result: {
				...base,
				data: {
					setupStatus: "READY" as const,
					runtimeStatus: (await running(context))
						? ("RUNNING" as const)
						: ("STOPPED" as const),
					...(!startup
						? {
								issues: [
									{
										scope: "RUNTIME" as const,
										code: "UPSTREAM_NOT_READY",
										message:
											"等待 execution-browser-extension 发布 Browser Executor client 配置",
										relatedModuleRefs: ["execution-browser-extension"],
										nextCommand: "platform setup",
									},
								],
							}
						: {}),
				},
			},
			observedEffects: [],
		};
	},
	setup: async (context: ModuleCommandContext) => ({
		result: { ...base, data: await ownFacts(context) },
		observedEffects: [],
	}),
	docs: async (_context: ModuleCommandContext) => ({
		result: {
			...base,
			data: {
				docs: readFileSync(
					new URL(
						import.meta.url.includes("/dist/") ? "../../DOCS.md" : "../DOCS.md",
						import.meta.url,
					),
					"utf8",
				),
			},
		},
		observedEffects: [],
	}),
	start: async (context: ModuleCommandContext) => {
		try {
			const service = await compose(context);
			const data = await service.start();
			services.set(key(context), service);
			return {
				result: { ...base, data },
				observedEffects: [
					...descriptor.effects.map((item) => item.description),
				],
			};
		} catch (error) {
			return {
				result: failed(
					"START_FAILED",
					error instanceof Error
						? error.message
						: "execution-runtime start failed",
				),
				observedEffects: [],
			};
		}
	},
	stop: async (context: ModuleCommandContext) => {
		const service = services.get(key(context));
		if (service) {
			await service.stop();
			services.delete(key(context));
			return {
				result: base,
				observedEffects: [
					...descriptor.effects.map((item) => item.description),
				],
			};
		}
		return {
			result: (await running(context))
				? failed(
						"STOP_FAILED",
						"execution-runtime is running without an owned lifecycle handle",
					)
				: base,
			observedEffects: [],
		};
	},
} as const;

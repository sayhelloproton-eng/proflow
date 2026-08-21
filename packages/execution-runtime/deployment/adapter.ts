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
const blockedSetupPlan = {
	steps: [
		{
			id: "STEP-EXECUTION-RUNTIME-01",
			title: "等待 Platform Host",
			state: "BLOCKED",
			responsible: "EXTERNAL",
			execution: {
				interactive: "platform setup --module platform-host",
				nonInteractive: "platform setup --module platform-host",
			},
			requiredInputs: [],
			verify: "platform status",
			successCondition: "配置状态变为“已就绪”",
			blockedReason: "platform-host 尚未发布 endpoint 与 identityTokenFile",
		},
		{
			id: "STEP-EXECUTION-RUNTIME-02",
			title: "等待 Model Runtime",
			description: "Execution 的模型决策入口尚不可用。",
			state: "BLOCKED",
			responsible: "EXTERNAL",
			execution: {
				interactive: "platform setup --module model-runtime",
				nonInteractive: "platform setup --module model-runtime",
			},
			requiredInputs: [],
			verify: "platform status",
			successCondition:
				"model-runtime 已发布 endpoint 与 transportCredentialFile",
			blockedReason: "model-runtime 尚未就绪",
		},
		{
			id: "STEP-EXECUTION-RUNTIME-03",
			title: "等待 Browser Executor",
			description: "Browser Effect 配置尚不可用。",
			state: "BLOCKED",
			responsible: "EXTERNAL",
			execution: {
				interactive: "platform setup --module execution-browser-extension",
				nonInteractive: "platform setup --module execution-browser-extension",
			},
			requiredInputs: [],
			verify: "platform status",
			successCondition:
				"execution-browser-extension 已发布 browserExecutorConfigPath",
			blockedReason: "execution-browser-extension 尚未就绪",
		},
	],
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
async function baseDependencies(context: ModuleCommandContext) {
	const host = await readModuleSharedFacts(context, "platform-host");
	const model = await readModuleSharedFacts(context, "model-runtime");
	const identityEndpoint = factString(host, "endpoint");
	const identityTokenFile = factString(host, "identityTokenFile");
	const modelEndpoint = factString(model, "endpoint");
	const modelCredentialFile = factString(model, "transportCredentialFile");
	return identityEndpoint &&
		identityTokenFile &&
		modelEndpoint &&
		modelCredentialFile
		? {
				identityEndpoint,
				identityTokenFile,
				modelEndpoint,
				modelCredentialFile,
			}
		: undefined;
}
async function dependencies(context: ModuleCommandContext) {
	const base = await baseDependencies(context);
	const browser = await readModuleSharedFacts(
		context,
		"execution-browser-extension",
	);
	const browserExecutorConfigPath = factString(
		browser,
		"browserExecutorConfigPath",
	);
	return base && browserExecutorConfigPath
		? {
				...base,
				browserExecutorConfigPath,
			}
		: undefined;
}
async function running(context: ModuleCommandContext) {
	const own = await ownFacts(context);
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
	const deps = await dependencies(context);
	if (!deps)
		throw new Error(
			"required Platform Host, Model Runtime, or Browser Executor shared facts are unavailable",
		);
	const [
		{ createFormalExecutionRuntimeLifecycle },
		{ parseExecutionRuntimeProcessConfig },
	] = await Promise.all([
		import("../src/formal-process.ts"),
		import("../src/service.ts"),
	]);
	const url = new URL(own.endpoint);
	return createFormalExecutionRuntimeLifecycle({
		config: parseExecutionRuntimeProcessConfig({
			host: url.hostname,
			port: Number(url.port),
			databasePath: own.databasePath,
			projectRoot: own.projectRoot,
			artifactRoot: own.artifactRoot,
			browserExecutorConfigPath: deps.browserExecutorConfigPath,
			transportCredentialFile: own.transportCredentialFile,
			identity: {
				endpoint: deps.identityEndpoint,
				tokenFile: deps.identityTokenFile,
			},
			modelDecision: {
				endpoint: deps.modelEndpoint,
				credentialFile: deps.modelCredentialFile,
			},
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
		const ready = await dependencies(context);
		return {
			result: {
				...base,
				data: {
					setupStatus: ready ? ("READY" as const) : ("BLOCKED" as const),
					runtimeStatus: (await running(context))
						? ("RUNNING" as const)
						: ("STOPPED" as const),
					...(ready
						? {}
						: {
								issues: [
									{
										scope: "SETUP" as const,
										code: "UPSTREAM_NOT_READY",
										message:
											"等待 platform-host、model-runtime 与 execution-browser-extension 发布运行所需信息",
										relatedModuleRefs: [
											"platform-host",
											"model-runtime",
											"execution-browser-extension",
										],
										nextCommand: "platform setup --module model-runtime",
									},
								],
							}),
				},
			},
			observedEffects: [],
		};
	},
	setup: async (context: ModuleCommandContext) => ({
		result: (await dependencies(context))
			? base
			: {
					...failed(
						"SETUP_FAILED",
						"required producer shared facts are unavailable",
					),
					data: blockedSetupPlan,
				},
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

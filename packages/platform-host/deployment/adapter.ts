import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
	deterministicLoopbackPort,
	ensureModuleSecretFile,
	type ModuleCommandContext,
	readModuleSharedFacts,
	writeModuleSharedFacts,
} from "@tomflow/proflow-module-contract";
import { descriptor } from "./descriptor.ts";

type Service = {
	start(): Promise<{ host: string; port: number }>;
	stop(): Promise<void>;
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
const stateRoot = (context: ModuleCommandContext) =>
	join(key(context), ".proflow");
const factString = (
	facts: Record<string, unknown> | undefined,
	name: string,
) => (typeof facts?.[name] === "string" ? String(facts[name]) : undefined);
async function ensureSecret(path: string) {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	if (!existsSync(path))
		await writeFile(path, `${randomBytes(32).toString("base64url")}\n`, {
			mode: 0o600,
		});
	await chmod(path, 0o600);
	const value = (await readFile(path, "utf8")).trim();
	if (value.length < 32) throw new Error(`invalid private credential ${path}`);
	return path;
}
async function ownFacts(context: ModuleCommandContext) {
	const root = stateRoot(context);
	const endpoint = `http://127.0.0.1:${deterministicLoopbackPort(context, descriptor.moduleRef)}`;
	const identityTokenFile = await ensureSecret(
		join(root, "execution", "secrets", "execution-identity.token"),
	);
	const taskApplicationTokenFile = await ensureSecret(
		join(root, "browser", "secrets", "task-application.token"),
	);
	const approvalApplicationTokenFile = await ensureSecret(
		join(root, "browser", "secrets", "approval-application.token"),
	);
	const gatewayTransportCredentialFile = await ensureModuleSecretFile(
		context,
		descriptor.moduleRef,
		"gateway-transport",
	);
	const facts = {
		endpoint,
		stateRoot: root,
		identityTokenFile,
		taskApplicationTokenFile,
		approvalApplicationTokenFile,
		gatewayTransportCredentialFile,
	};
	await writeModuleSharedFacts(context, descriptor.moduleRef, facts);
	return facts;
}
async function dependencies(context: ModuleCommandContext) {
	const execution = await readModuleSharedFacts(context, "execution-runtime");
	const model = await readModuleSharedFacts(context, "model-runtime");
	const executionBaseUrl = factString(execution, "endpoint");
	const executionTransportCredentialFile = factString(
		execution,
		"transportCredentialFile",
	);
	const modelBaseUrl = factString(model, "endpoint");
	const modelTransportCredentialFile = factString(
		model,
		"transportCredentialFile",
	);
	return executionBaseUrl &&
		executionTransportCredentialFile &&
		modelBaseUrl &&
		modelTransportCredentialFile
		? {
				executionBaseUrl,
				executionTransportCredentialFile,
				modelBaseUrl,
				modelTransportCredentialFile,
			}
		: undefined;
}
async function running(context: ModuleCommandContext) {
	const { endpoint } = await ownFacts(context);
	try {
		return (
			await fetch(`${endpoint}/ready`, { signal: AbortSignal.timeout(500) })
		).ok;
	} catch {
		return false;
	}
}
async function compose(context: ModuleCommandContext): Promise<Service> {
	const own = await ownFacts(context);
	const deps = await dependencies(context);
	if (!deps)
		throw new Error("required Execution/Model shared facts are unavailable");
	const { createPlatformHost, parsePlatformHostConfig } = await import(
		"../src/index.ts"
	);
	const url = new URL(own.endpoint);
	const host = createPlatformHost({
		config: parsePlatformHostConfig({
			stateRoot: own.stateRoot,
			workspaceRoot: key(context),
			host: url.hostname,
			port: Number(url.port),
			executionBaseUrl: deps.executionBaseUrl,
			executionTransportCredentialFile: deps.executionTransportCredentialFile,
			modelBaseUrl: deps.modelBaseUrl,
			modelTransportCredentialFile: deps.modelTransportCredentialFile,
			gatewayTransportCredentialFile: own.gatewayTransportCredentialFile,
			roles: [],
		}),
	});
	return { start: () => host.start(), stop: () => host.stop() };
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
			observedEffects: service ? ["Manage the platform-host process"] : [],
		};
	},
	status: async (context: ModuleCommandContext) => ({
		result: {
			...base,
			data: {
				setupStatus: (await dependencies(context))
					? ("READY" as const)
					: ("FAILED" as const),
				runtimeStatus: (await running(context))
					? ("RUNNING" as const)
					: ("STOPPED" as const),
			},
		},
		observedEffects: [],
	}),
	setup: async (context: ModuleCommandContext) => ({
		result: (await dependencies(context))
			? base
			: failed(
					"SETUP_FAILED",
					"required Execution/Model producer shared facts are unavailable",
				),
		observedEffects: [],
	}),
	docs: async (_context: ModuleCommandContext) => ({
		result: {
			...base,
			data: {
				docs: readFileSync(new URL("../DOCS.md", import.meta.url), "utf8"),
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
				observedEffects: ["Manage the platform-host process"],
			};
		} catch (error) {
			return {
				result: failed(
					"START_FAILED",
					error instanceof Error ? error.message : "platform-host start failed",
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
				observedEffects: ["Manage the platform-host process"],
			};
		}
		return {
			result: (await running(context))
				? failed(
						"STOP_FAILED",
						"platform-host is running without an owned lifecycle handle",
					)
				: base,
			observedEffects: [],
		};
	},
} as const;

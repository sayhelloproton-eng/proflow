import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import {
	deterministicLoopbackPort,
	type ModuleCommandContext,
	readModuleSharedFacts,
	writeModuleSharedFacts,
} from "@tomflow/proflow-module-contract";
import { descriptor } from "./descriptor.ts";

type GatewayProcess = {
	start(): Promise<{ host: string; port: number }>;
	stop(): Promise<void>;
};
const services = new Map<string, GatewayProcess>();
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
	const localBaseUrl = `http://127.0.0.1:${deterministicLoopbackPort(context, descriptor.moduleRef)}`;
	const tunnel = await readModuleSharedFacts(context, "dev-tunnel");
	const publicBaseUrl = factString(tunnel, "publicBaseUrl");
	const facts = { localBaseUrl, ...(publicBaseUrl ? { publicBaseUrl } : {}) };
	await writeModuleSharedFacts(context, descriptor.moduleRef, facts);
	return facts;
}
async function dependencies(context: ModuleCommandContext) {
	const tunnel = await readModuleSharedFacts(context, "dev-tunnel");
	const host = await readModuleSharedFacts(context, "platform-host");
	const publicBaseUrl = factString(tunnel, "publicBaseUrl");
	const downstreamBaseUrl = factString(host, "endpoint");
	const downstreamCredentialFile = factString(
		host,
		"gatewayTransportCredentialFile",
	);
	const stateRoot = factString(host, "stateRoot");
	return publicBaseUrl &&
		downstreamBaseUrl &&
		downstreamCredentialFile &&
		stateRoot
		? { publicBaseUrl, downstreamBaseUrl, downstreamCredentialFile, stateRoot }
		: undefined;
}
async function running(context: ModuleCommandContext) {
	const own = await ownFacts(context);
	try {
		return (
			await fetch(`${own.localBaseUrl}/ready`, {
				signal: AbortSignal.timeout(500),
			})
		).ok;
	} catch {
		return false;
	}
}
async function compose(context: ModuleCommandContext): Promise<GatewayProcess> {
	const own = await ownFacts(context);
	const deps = await dependencies(context);
	if (!deps)
		throw new Error(
			"public-ingress or platform-host shared facts are unavailable",
		);
	const credentialFile = join(
		deps.stateRoot,
		"agent",
		"secrets",
		"role-credentials.json",
	);
	if (!existsSync(credentialFile))
		throw new Error(
			"Agent role credential store is not materialized by Platform Host",
		);
	const { createAgentGatewayProcess, parseAgentGatewayProcessConfig } =
		await import("../src/process.ts");
	const listener = new URL(own.localBaseUrl);
	return createAgentGatewayProcess({
		config: parseAgentGatewayProcessConfig({
			host: listener.hostname,
			port: Number(listener.port),
			publicBaseUrl: deps.publicBaseUrl,
			downstreamBaseUrl: deps.downstreamBaseUrl,
			credentialFile,
			downstreamCredentialFile: deps.downstreamCredentialFile,
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
			observedEffects: service ? ["Manage the declared service process"] : [],
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
					"public-ingress or platform-host producer shared facts are unavailable",
				),
		observedEffects: [],
	}),
	docs: async (_context: ModuleCommandContext) => ({
		result: { ...base, data: { docs: "DOCS.md", setup: "SETUP.md" } },
		observedEffects: [],
	}),
	start: async (context: ModuleCommandContext) => {
		try {
			const service = await compose(context);
			const data = await service.start();
			services.set(key(context), service);
			await ownFacts(context);
			return {
				result: { ...base, data },
				observedEffects: ["Manage the declared service process"],
			};
		} catch (error) {
			return {
				result: failed(
					"START_FAILED",
					error instanceof Error ? error.message : "agent-gateway start failed",
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
				observedEffects: ["Manage the declared service process"],
			};
		}
		return {
			result: (await running(context))
				? failed(
						"STOP_FAILED",
						"agent-gateway is running without an owned lifecycle handle",
					)
				: base,
			observedEffects: [],
		};
	},
} as const;

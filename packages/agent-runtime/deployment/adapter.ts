import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { ModuleCommandContext } from "@tomflow/proflow-module-contract";
import { createAgentRuntime } from "../src/index.ts";
import { descriptor } from "./descriptor.ts";

const base = {
	contract: "deployment.result.v1",
	ok: true,
	status: "SUCCEEDED",
	moduleRef: descriptor.moduleRef,
	moduleVersion: descriptor.moduleVersion,
} as const;

const roleCredentialStore = (context: ModuleCommandContext) =>
	join(
		context.workspaceRoot,
		".proflow",
		"agent",
		"secrets",
		"role-credentials.json",
	);

function roleStoreReady(context: ModuleCommandContext): boolean {
	const path = roleCredentialStore(context);
	if (!existsSync(path)) return false;
	try {
		const value: unknown = JSON.parse(readFileSync(path, "utf8"));
		return (
			typeof value === "object" &&
			value !== null &&
			!Array.isArray(value) &&
			Object.values(value).every(
				(credential) =>
					typeof credential === "string" && credential.length >= 32,
			)
		);
	} catch {
		return false;
	}
}

async function ensureRoleStore(context: ModuleCommandContext) {
	const runtime = await createAgentRuntime({
		proflowRoot: join(context.workspaceRoot, ".proflow"),
		task: {
			async getTask() {
				throw new Error("TASK_API_NOT_AVAILABLE_DURING_DEPLOYMENT_SETUP");
			},
			async hasNonTerminalRoleUsage() {
				return false;
			},
		},
	});
	runtime.close();
	if (!roleStoreReady(context))
		throw new Error("ROLE_STORE_INITIALIZATION_FAILED");
}

const ensure = async (context: ModuleCommandContext) => {
	try {
		await ensureRoleStore(context);
		return {
			result: base,
			observedEffects: ["Materialize the Agent Runtime durable role store"],
		};
	} catch (error) {
		return {
			result: {
				...base,
				ok: false as const,
				status: "FAILED" as const,
				error: {
					code: "SETUP_FAILED" as const,
					message:
						error instanceof Error
							? error.message
							: "Agent Runtime role store initialization failed",
					retryable: true,
				},
			},
			observedEffects: [] as string[],
		};
	}
};

const success = () => ({ result: base, observedEffects: [] as string[] });

export const behaviorAdapter = {
	install: ensure,
	uninstall: success,
	status: (context: ModuleCommandContext) => {
		const ready = roleStoreReady(context);
		return {
			result: {
				...base,
				data: {
					setupStatus: ready
						? ("READY" as const)
						: ("ACTION_REQUIRED" as const),
					runtimeStatus: "NOT_APPLICABLE" as const,
					...(ready
						? {}
						: {
								issues: [
									{
										scope: "SETUP" as const,
										code: "ROLE_STORE_NOT_READY",
										message:
											"Agent Runtime durable Role credential store 尚未初始化",
										relatedModuleRefs: [],
										nextCommand: "platform setup",
									},
								],
							}),
				},
			},
			observedEffects: [] as string[],
		};
	},
	setup: ensure,
	docs: () => ({
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
		observedEffects: [] as string[],
	}),
	start: success,
	stop: success,
} as const;

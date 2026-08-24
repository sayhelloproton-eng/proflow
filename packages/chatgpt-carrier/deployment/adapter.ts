import { readFileSync } from "node:fs";

import type { ModuleCommandContext } from "@tomflow/proflow-module-contract";
import { descriptor } from "./descriptor.ts";

const base = {
	contract: "deployment.result.v1",
	ok: true,
	status: "SUCCEEDED",
	moduleRef: descriptor.moduleRef,
	moduleVersion: descriptor.moduleVersion,
} as const;

const effect = "Observes ChatGPT Web external availability";
const CHATGPT_ORIGIN = "https://chatgpt.com/";

async function probeChatGpt(): Promise<{
	available: boolean;
	statusCode?: number;
	message: string;
}> {
	try {
		const response = await fetch(CHATGPT_ORIGIN, {
			method: "HEAD",
			redirect: "follow",
			signal: AbortSignal.timeout(5_000),
		});
		const available =
			response.ok || response.status === 401 || response.status === 403;
		return {
			available,
			statusCode: response.status,
			message: `ChatGPT Web returned HTTP ${response.status}`,
		};
	} catch (error) {
		return {
			available: false,
			message:
				error instanceof Error
					? error.message
					: "ChatGPT Web reachability observation failed",
		};
	}
}
function unavailableResult(message: string) {
	return {
		result: {
			...base,
			ok: false as const,
			status: "ACTION_REQUIRED" as const,
			data: {
				setupStatus: "ACTION_REQUIRED" as const,
				runtimeStatus: "FAILED" as const,
				issues: [
					{
						scope: "SETUP" as const,
						code: "CHATGPT_WEB_UNAVAILABLE",
						message,
						relatedModuleRefs: [],
						nextCommand: "platform setup --module chatgpt-carrier",
					},
				],
			},
			actionRequired: {
				action: "restore-chatgpt-web-access",
				description:
					"Restore network/ChatGPT Web access, then rerun setup. Role materialization and capability verification remain owned by the Agent packages.",
			},
		},
		observedEffects: [effect],
		externalAvailabilityClaim: "UNAVAILABLE" as const,
		externalAvailabilityEvidence: "real" as const,
	};
}

async function observe() {
	const observation = await probeChatGpt();
	if (!observation.available) return unavailableResult(observation.message);
	return {
		result: {
			...base,
			data: {
				setupStatus: "READY" as const,
				runtimeStatus: "RUNNING" as const,
			},
		},
		observedEffects: [effect],
		externalAvailabilityClaim: "AVAILABLE" as const,
		externalAvailabilityEvidence: "real" as const,
	};
}
export const behaviorAdapter = {
	install: async (_context: ModuleCommandContext) => ({
		result: base,
		observedEffects: [],
	}),
	uninstall: async (_context: ModuleCommandContext) => ({
		result: base,
		observedEffects: [],
	}),
	status: async (_context: ModuleCommandContext) => observe(),
	setup: async (_context: ModuleCommandContext) => observe(),
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
	start: async (_context: ModuleCommandContext) => observe(),
	stop: async (_context: ModuleCommandContext) => ({
		result: base,
		observedEffects: [],
	}),
} as const;

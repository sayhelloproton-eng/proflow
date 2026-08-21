import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
	type ModuleCommandContext,
	writeModuleSharedFacts,
} from "@tomflow/proflow-module-contract";
import { createDevTunnelRuntime } from "../src/resource-adapter.ts";
import { descriptor } from "./descriptor.ts";

const base = {
	contract: "deployment.result.v1",
	ok: true,
	status: "SUCCEEDED",
	moduleRef: descriptor.moduleRef,
	moduleVersion: descriptor.moduleVersion,
} as const;
const setupPlan = {
	steps: [
		{
			id: "STEP-DEV-TUNNEL-01",
			title: "选择或创建持久 Tunnel",
			state: "TODO",
			responsible: "USER",
			execution: {
				interactive: "proflow-dev-tunnel setup",
				nonInteractive:
					"proflow-dev-tunnel setup --tunnel-id <id> --public-base-url <url>",
			},
			requiredInputs: [
				{ name: "tunnelId", description: "Tunnel ID", sensitive: false },
				{
					name: "publicBaseUrl",
					description: "公开 HTTPS URL",
					sensitive: false,
				},
			],
			verify: "proflow-dev-tunnel verify",
			successCondition: "配置状态变为“已就绪”",
		},
	],
} as const;
const processEffect = "Manage the dev-tunnel public ingress process";
type SetupState = {
	contract: "proflow.dev-tunnel-setup.v1";
	tunnelId: string;
	publicBaseUrl: string;
};
const stateDir = (context: ModuleCommandContext) =>
	join(
		resolve(context.workspaceRoot),
		".proflow",
		"runtime",
		"external-resources",
		"dev-tunnel",
	);
const stateFile = (context: ModuleCommandContext) =>
	join(stateDir(context), "setup.json");
const processFile = (context: ModuleCommandContext) =>
	join(stateDir(context), "process.json");
async function readState(
	context: ModuleCommandContext,
): Promise<SetupState | undefined> {
	try {
		const raw = JSON.parse(
			await readFile(stateFile(context), "utf8"),
		) as Partial<SetupState>;
		if (
			raw.contract !== "proflow.dev-tunnel-setup.v1" ||
			typeof raw.tunnelId !== "string" ||
			!raw.tunnelId ||
			typeof raw.publicBaseUrl !== "string"
		)
			return undefined;
		const url = new URL(raw.publicBaseUrl);
		if (url.protocol !== "https:") return undefined;
		return raw as SetupState;
	} catch {
		return undefined;
	}
}
async function writeState(
	context: ModuleCommandContext,
	state: SetupState,
): Promise<void> {
	await mkdir(stateDir(context), { recursive: true, mode: 0o700 });
	const tmp = `${stateFile(context)}.${process.pid}.tmp`;
	await writeFile(
		tmp,
		`${JSON.stringify(state, null, 2)}
`,
		{ encoding: "utf8", mode: 0o600 },
	);
	await rename(tmp, stateFile(context));
}
function setupInput(context: ModuleCommandContext): Partial<SetupState> {
	if (
		typeof context.input !== "object" ||
		context.input === null ||
		Array.isArray(context.input)
	)
		return {};
	const tunnelId = Reflect.get(context.input, "tunnelId");
	const publicBaseUrl = Reflect.get(context.input, "publicBaseUrl");
	return {
		...(typeof tunnelId === "string" && tunnelId ? { tunnelId } : {}),
		...(typeof publicBaseUrl === "string" && publicBaseUrl
			? { publicBaseUrl }
			: {}),
	};
}
function runtime(context: ModuleCommandContext, state?: SetupState) {
	return createDevTunnelRuntime({
		...(state
			? { tunnelId: state.tunnelId, publicBaseUrl: state.publicBaseUrl }
			: {}),
		processStateFile: processFile(context),
	});
}
export const behaviorAdapter = {
	install: async (context: ModuleCommandContext) => {
		await mkdir(stateDir(context), { recursive: true, mode: 0o700 });
		const state = await readState(context);
		if (state)
			await writeModuleSharedFacts(context, descriptor.moduleRef, {
				tunnelId: state.tunnelId,
				publicBaseUrl: state.publicBaseUrl,
			});
		return { result: base, observedEffects: [] };
	},
	uninstall: async (context: ModuleCommandContext) => {
		const state = await readState(context);
		if (!state) return { result: base, observedEffects: [] };
		try {
			const stopped = await runtime(context, state).stop();
			return stopped.state === "STOPPED"
				? { result: base, observedEffects: [processEffect] }
				: {
						result: {
							...base,
							ok: false as const,
							status: "FAILED" as const,
							error: {
								code: "UNINSTALL_FAILED" as const,
								message: "dev-tunnel stop state is UNKNOWN",
								retryable: true,
							},
						},
						observedEffects: [],
					};
		} catch (error) {
			return {
				result: {
					...base,
					ok: false as const,
					status: "FAILED" as const,
					error: {
						code: "UNINSTALL_FAILED" as const,
						message:
							error instanceof Error
								? error.message
								: "failed to stop dev-tunnel",
						retryable: true,
					},
				},
				observedEffects: [],
			};
		}
	},
	status: async (context: ModuleCommandContext) => {
		const state = await readState(context);
		if (!state) {
			return {
				result: {
					...base,
					data: {
						setupStatus: "ACTION_REQUIRED" as const,
						runtimeStatus: "STOPPED" as const,
					},
				},
				observedEffects: [],
			};
		}
		await writeModuleSharedFacts(context, descriptor.moduleRef, {
			tunnelId: state.tunnelId,
			publicBaseUrl: state.publicBaseUrl,
		});
		const rt = runtime(context, state);
		const login = await rt.loginStatus();
		const observed = await rt.status();
		const configured = state !== undefined && login === "LOGGED_IN";
		const runtimeStatus =
			observed.state === "RUNNING"
				? ("RUNNING" as const)
				: observed.state === "STOPPED"
					? ("STOPPED" as const)
					: configured
						? ("FAILED" as const)
						: ("STOPPED" as const);
		return {
			result: {
				...base,
				data: {
					setupStatus: configured
						? ("READY" as const)
						: ("ACTION_REQUIRED" as const),
					runtimeStatus,
				},
			},
			observedEffects: [],
		};
	},
	setup: async (context: ModuleCommandContext) => {
		await mkdir(stateDir(context), { recursive: true, mode: 0o700 });
		const previous = await readState(context);
		const supplied = setupInput(context);
		const candidate = { ...(previous ?? {}), ...supplied };
		const rt = runtime(context, previous);
		const login = await rt.loginStatus();
		if (login !== "LOGGED_IN")
			return {
				result: {
					...base,
					ok: false as const,
					status: "ACTION_REQUIRED" as const,
					data: setupPlan,
					actionRequired: {
						action: "complete-tunnel-login",
						description: `Run devtunnel user login, complete Microsoft authentication, then rerun platform setup --module dev-tunnel --workspace ${JSON.stringify(context.workspaceRoot)}.`,
					},
				},
				observedEffects: [],
			};
		if (
			typeof candidate.tunnelId !== "string" ||
			typeof candidate.publicBaseUrl !== "string"
		)
			return {
				result: {
					...base,
					ok: false as const,
					status: "ACTION_REQUIRED" as const,
					data: setupPlan,
					actionRequired: {
						action: "select-or-create-tunnel",
						description:
							"Create/select the persistent tunnel, then run proflow-dev-tunnel setup --tunnel-id <id> --public-base-url <url>.",
					},
				},
				observedEffects: [],
			};
		try {
			const url = new URL(candidate.publicBaseUrl);
			if (url.protocol !== "https:")
				throw new TypeError("publicBaseUrl must be HTTPS");
			const state: SetupState = {
				contract: "proflow.dev-tunnel-setup.v1",
				tunnelId: candidate.tunnelId,
				publicBaseUrl: url.href,
			};
			await writeState(context, state);
			await writeModuleSharedFacts(context, descriptor.moduleRef, {
				tunnelId: state.tunnelId,
				publicBaseUrl: state.publicBaseUrl,
			});
			return { result: base, observedEffects: [] };
		} catch (error) {
			return {
				result: {
					...base,
					ok: false as const,
					status: "ACTION_REQUIRED" as const,
					data: setupPlan,
					actionRequired: {
						action: "correct-tunnel-facts",
						description:
							error instanceof Error
								? error.message
								: "Tunnel setup facts are invalid",
					},
				},
				observedEffects: [],
			};
		}
	},
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
		const state = await readState(context);
		if (!state)
			return {
				result: {
					...base,
					ok: false as const,
					status: "FAILED" as const,
					error: {
						code: "START_FAILED" as const,
						message: "dev-tunnel setup is not READY",
						retryable: true,
					},
				},
				observedEffects: [],
			};
		const rt = runtime(context, state);
		if ((await rt.loginStatus()) !== "LOGGED_IN")
			return {
				result: {
					...base,
					ok: false as const,
					status: "FAILED" as const,
					error: {
						code: "START_FAILED" as const,
						message: "Microsoft Dev Tunnel login is not ready",
						retryable: true,
					},
				},
				observedEffects: [],
			};
		try {
			const observed = await rt.start();
			return observed.state === "RUNNING"
				? {
						result: { ...base, data: observed },
						observedEffects: [processEffect],
					}
				: {
						result: {
							...base,
							ok: false as const,
							status: "FAILED" as const,
							error: {
								code: "START_FAILED" as const,
								message: "dev-tunnel did not reach RUNNING",
								retryable: true,
							},
						},
						observedEffects: [],
					};
		} catch (error) {
			return {
				result: {
					...base,
					ok: false as const,
					status: "FAILED" as const,
					error: {
						code: "START_FAILED" as const,
						message:
							error instanceof Error
								? error.message
								: "failed to start dev-tunnel",
						retryable: true,
					},
				},
				observedEffects: [],
			};
		}
	},
	stop: async (context: ModuleCommandContext) => {
		const state = await readState(context);
		if (!state) return { result: base, observedEffects: [] };
		try {
			const observed = await runtime(context, state).stop();
			return observed.state === "STOPPED"
				? { result: base, observedEffects: [processEffect] }
				: {
						result: {
							...base,
							ok: false as const,
							status: "FAILED" as const,
							error: {
								code: "STOP_FAILED" as const,
								message: "dev-tunnel stop state is UNKNOWN",
								retryable: true,
							},
						},
						observedEffects: [],
					};
		} catch (error) {
			return {
				result: {
					...base,
					ok: false as const,
					status: "FAILED" as const,
					error: {
						code: "STOP_FAILED" as const,
						message:
							error instanceof Error
								? error.message
								: "failed to stop dev-tunnel",
						retryable: true,
					},
				},
				observedEffects: [],
			};
		}
	},
} as const;

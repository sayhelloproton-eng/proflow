import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { ModuleCommandContext } from "@tomflow/proflow-module-contract";
import type {
	CarrierVerificationObservation,
	VerificationState,
} from "../src/resource-adapter.ts";
import { UNVERIFIED_CARRIER_VERIFICATION } from "../src/resource-adapter.ts";
import { descriptor } from "./descriptor.ts";

const base = {
	contract: "deployment.result.v1",
	ok: true,
	status: "SUCCEEDED",
	moduleRef: descriptor.moduleRef,
	moduleVersion: descriptor.moduleVersion,
} as const;
const effect = "Observes the ChatGPT Custom GPT carrier";
const setupPlan = {
	steps: [
		{
			id: "STEP-CHATGPT-CARRIER-01",
			title: "选择真实 Custom GPT",
			description: "打开管理页，选择载体并保存真实 GPT URL。",
			state: "TODO",
			responsible: "USER",
			execution: {
				interactive: "pnpm exec -- proflow-chatgpt-carrier setup 01",
				nonInteractive:
					"pnpm exec -- proflow-chatgpt-carrier setup 01 --carrier-url <url>",
			},
			requiredInputs: [
				{ name: "carrierUrl", description: "Custom GPT URL", sensitive: false },
			],
			verify:
				"pnpm exec -- proflow-chatgpt-carrier setup 01 --carrier-url <url>",
			successCondition: "真实 Carrier URL 已保存",
			humanAction: "在 ChatGPT 中选择或创建 Custom GPT，并复制 URL。",
		},
		{
			id: "STEP-CHATGPT-CARRIER-02",
			title: "检查 Carrier 能力",
			description: "逐项确认 Actions、OpenAPI、认证和所需 GPT 能力。",
			state: "TODO",
			responsible: "USER",
			execution: {
				interactive: "pnpm exec -- proflow-chatgpt-carrier setup 02",
				nonInteractive:
					"pnpm exec -- proflow-chatgpt-carrier setup 02 --confirm-capabilities",
			},
			requiredInputs: [],
			verify: "pnpm exec -- proflow-chatgpt-carrier verify",
			successCondition: "Carrier 能力检查已记录",
			humanAction: "在 Custom GPT 配置页逐项核对脚本显示的检查项。",
		},
		{
			id: "STEP-CHATGPT-CARRIER-03",
			title: "验证 Carrier",
			description: "重新观察 URL 和能力证据，确认最终状态。",
			state: "TODO",
			responsible: "AI",
			execution: {
				interactive: "pnpm exec -- proflow-chatgpt-carrier setup 03",
				nonInteractive: "pnpm exec -- proflow-chatgpt-carrier verify",
			},
			requiredInputs: [],
			verify: "pnpm exec -- proflow-chatgpt-carrier verify",
			successCondition: "chatgpt-carrier.setupStatus=READY",
		},
	],
} as const;
type CarrierState = {
	contract: "proflow.chatgpt-carrier-state.v1";
	carrierUrl: string;
};
type EvidenceFile = CarrierVerificationObservation & {
	contract: "proflow.chatgpt-carrier-verification.v1";
	carrierUrl: string;
	observedAt: string;
};
const verificationStates = new Set<VerificationState>([
	"VERIFIED",
	"UNVERIFIED",
	"FAILED",
	"NOT_REQUIRED",
]);
const keys = [
	"reachable",
	"actionsEnabled",
	"openApiInstalled",
	"actionAuthValid",
	"fileBridge",
	"codeInterpreter",
	"webSearch",
	"appsDisabledWhenRequired",
] as const;
const required = new Set<(typeof keys)[number]>([
	"reachable",
	"actionsEnabled",
	"openApiInstalled",
	"actionAuthValid",
]);
const stateDir = (context: ModuleCommandContext) =>
	join(
		resolve(context.workspaceRoot),
		".proflow",
		"runtime",
		"external-resources",
		"chatgpt-carrier",
	);
const stateFile = (context: ModuleCommandContext) =>
	join(stateDir(context), "setup.json");
const evidenceFile = (context: ModuleCommandContext) =>
	join(stateDir(context), "verification.json");
async function readState(
	context: ModuleCommandContext,
): Promise<CarrierState | undefined> {
	try {
		const raw = JSON.parse(
			await readFile(stateFile(context), "utf8"),
		) as Partial<CarrierState>;
		if (
			raw.contract !== "proflow.chatgpt-carrier-state.v1" ||
			typeof raw.carrierUrl !== "string" ||
			!raw.carrierUrl.startsWith("https://chatgpt.com/g/")
		)
			return undefined;
		return raw as CarrierState;
	} catch {
		return undefined;
	}
}
async function atomicJson(path: string, value: unknown) {
	await mkdir(resolve(path, ".."), { recursive: true, mode: 0o700 });
	const tmp = `${path}.${process.pid}.tmp`;
	await writeFile(
		tmp,
		`${JSON.stringify(value, null, 2)}
`,
		{ encoding: "utf8", mode: 0o600 },
	);
	await rename(tmp, path);
}
async function readVerification(
	context: ModuleCommandContext,
	state: CarrierState,
): Promise<CarrierVerificationObservation> {
	try {
		const raw = JSON.parse(
			await readFile(evidenceFile(context), "utf8"),
		) as Partial<EvidenceFile>;
		if (
			raw.contract !== "proflow.chatgpt-carrier-verification.v1" ||
			raw.carrierUrl !== state.carrierUrl ||
			typeof raw.observedAt !== "string" ||
			Number.isNaN(Date.parse(raw.observedAt)) ||
			!keys.every((key) =>
				verificationStates.has(raw[key] as VerificationState),
			)
		)
			return {
				...UNVERIFIED_CARRIER_VERIFICATION,
				message: "Carrier verification evidence is missing, stale, or invalid",
			};
		return Object.fromEntries(
			keys.map((key) => [key, raw[key]]),
		) as unknown as CarrierVerificationObservation;
	} catch {
		return UNVERIFIED_CARRIER_VERIFICATION;
	}
}
function healthy(observation: CarrierVerificationObservation): boolean {
	if (keys.some((key) => observation[key] === "FAILED")) return false;
	if (![...required].every((key) => observation[key] === "VERIFIED"))
		return false;
	return keys
		.filter((key) => !required.has(key))
		.every(
			(key) =>
				observation[key] === "VERIFIED" || observation[key] === "NOT_REQUIRED",
		);
}
async function probe(state: CarrierState) {
	try {
		const response = await fetch(state.carrierUrl, {
			method: "HEAD",
			redirect: "follow",
			signal: AbortSignal.timeout(5000),
		});
		return {
			available:
				response.ok || response.status === 401 || response.status === 403,
			message: `Carrier URL returned HTTP ${response.status}`,
		};
	} catch (error) {
		return {
			available: false,
			message:
				error instanceof Error
					? error.message
					: "Carrier reachability observation failed",
		};
	}
}
function inputRecord(context: ModuleCommandContext): Record<string, unknown> {
	return typeof context.input === "object" &&
		context.input !== null &&
		!Array.isArray(context.input)
		? (context.input as Record<string, unknown>)
		: {};
}
export const behaviorAdapter = {
	install: async (context: ModuleCommandContext) => {
		await mkdir(stateDir(context), { recursive: true, mode: 0o700 });
		return { result: base, observedEffects: [] };
	},
	uninstall: async (_context: ModuleCommandContext) => ({
		result: base,
		observedEffects: [],
	}),
	status: async (context: ModuleCommandContext) => {
		const state = await readState(context);
		if (!state)
			return {
				result: {
					...base,
					data: {
						setupStatus: "ACTION_REQUIRED" as const,
						runtimeStatus: "STOPPED" as const,
						issues: [
							{
								scope: "SETUP" as const,
								code: "CARRIER_SETUP_REQUIRED",
								message: "尚未登记可用的 Custom GPT Carrier",
								relatedModuleRefs: [],
								nextCommand: "platform setup --module chatgpt-carrier",
							},
						],
					},
				},
				observedEffects: [],
				externalAvailabilityClaim: "UNKNOWN" as const,
				externalAvailabilityEvidence: "none" as const,
			};
		const [verification, carrier] = await Promise.all([
			readVerification(context, state),
			probe(state),
		]);
		const setupReady = healthy(verification);
		return {
			result: {
				...base,
				data: {
					setupStatus: setupReady
						? ("READY" as const)
						: ("ACTION_REQUIRED" as const),
					runtimeStatus: carrier.available
						? ("RUNNING" as const)
						: ("FAILED" as const),
					...(!setupReady || !carrier.available
						? {
								issues: [
									...(!setupReady
										? [
												{
													scope: "SETUP" as const,
													code: "CARRIER_VERIFICATION_REQUIRED",
													message: "Custom GPT Carrier 尚未通过能力验证",
													relatedModuleRefs: [],
													nextCommand:
														"platform setup --module chatgpt-carrier",
												},
											]
										: []),
									...(!carrier.available
										? [
												{
													scope: "RUNTIME" as const,
													code: "CARRIER_UNREACHABLE",
													message: "已登记的 Custom GPT Carrier 当前不可达",
													relatedModuleRefs: [],
													nextCommand:
														"pnpm exec -- proflow-chatgpt-carrier verify",
												},
											]
										: []),
								],
							}
						: {}),
				},
			},
			observedEffects: [effect],
			externalAvailabilityClaim: carrier.available
				? ("AVAILABLE" as const)
				: ("UNAVAILABLE" as const),
			externalAvailabilityEvidence: "real" as const,
		};
	},
	setup: async (context: ModuleCommandContext) => {
		await mkdir(stateDir(context), { recursive: true, mode: 0o700 });
		const supplied = inputRecord(context);
		const previous = await readState(context);
		const carrierUrl =
			typeof supplied.carrierUrl === "string"
				? supplied.carrierUrl
				: previous?.carrierUrl;
		if (!carrierUrl)
			return {
				result: {
					...base,
					ok: false as const,
					status: "ACTION_REQUIRED" as const,
					data: setupPlan,
					actionRequired: {
						action: "materialize-custom-gpt-carrier",
						description:
							"Create or select the real Custom GPT, then run proflow-chatgpt-carrier setup --carrier-url <gpt-url>.",
					},
				},
				observedEffects: [],
			};
		if (!carrierUrl.startsWith("https://chatgpt.com/g/"))
			return {
				result: {
					...base,
					ok: false as const,
					status: "ACTION_REQUIRED" as const,
					data: setupPlan,
					actionRequired: {
						action: "correct-carrier-url",
						description:
							"carrierUrl must be a real https://chatgpt.com/g/... URL. Rerun proflow-chatgpt-carrier setup --carrier-url <gpt-url>.",
					},
				},
				observedEffects: [],
			};
		const state: CarrierState = {
			contract: "proflow.chatgpt-carrier-state.v1",
			carrierUrl,
		};
		await atomicJson(stateFile(context), state);
		const suppliedVerification = supplied.verification;
		if (
			typeof suppliedVerification === "object" &&
			suppliedVerification !== null &&
			!Array.isArray(suppliedVerification)
		) {
			const record = suppliedVerification as Record<string, unknown>;
			if (
				keys.every((key) =>
					verificationStates.has(record[key] as VerificationState),
				)
			) {
				const evidence = {
					contract: "proflow.chatgpt-carrier-verification.v1",
					carrierUrl,
					observedAt: new Date().toISOString(),
					...Object.fromEntries(keys.map((key) => [key, record[key]])),
				};
				await atomicJson(evidenceFile(context), evidence);
			}
		}
		const verification = await readVerification(context, state);
		if (!healthy(verification))
			return {
				result: {
					...base,
					ok: false as const,
					status: "ACTION_REQUIRED" as const,
					data: setupPlan,
					actionRequired: {
						action: "verify-carrier",
						description:
							verification.message ??
							"Complete real Custom GPT Actions/auth/File Bridge verification, then rerun setup.",
					},
				},
				observedEffects: [],
			};
		const carrier = await probe(state);
		return {
			result: carrier.available
				? base
				: {
						...base,
						ok: false as const,
						status: "ACTION_REQUIRED" as const,
						data: setupPlan,
						actionRequired: {
							action: "repair-carrier",
							description: carrier.message,
						},
					},
			observedEffects: [effect],
		};
	},
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
		const state = await readState(context);
		if (!state)
			return {
				result: {
					...base,
					ok: false as const,
					status: "FAILED" as const,
					error: {
						code: "START_FAILED" as const,
						message: "ChatGPT carrier setup is not READY",
						retryable: true,
					},
				},
				observedEffects: [],
			};
		const verification = await readVerification(context, state);
		const carrier = await probe(state);
		return {
			result:
				healthy(verification) && carrier.available
					? base
					: {
							...base,
							ok: false as const,
							status: "FAILED" as const,
							error: {
								code: "START_FAILED" as const,
								message: carrier.available
									? "ChatGPT carrier verification is incomplete"
									: carrier.message,
								retryable: true,
							},
						},
			observedEffects: [effect],
		};
	},
	stop: async (_context: ModuleCommandContext) => ({
		result: base,
		observedEffects: [],
	}),
} as const;

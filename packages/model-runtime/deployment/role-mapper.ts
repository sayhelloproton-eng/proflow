import type { ModelCapabilityProfile } from "@tomflow/proflow-model-contracts";
import { VISION_CAPABILITY_PROBE_PNG } from "../src/capability-probe-fixture.ts";

export type ModelDeploymentEvidence = {
	modelRef: string;
	text: boolean;
	vision: boolean;
	structuredOutput: "native" | "prompted" | "unsupported";
	reasoning: "thinking" | "no-thinking";
	contextWindow: number;
	maxOutputTokens: number;
	verifiedAt: string;
	metadataSignals?: readonly string[];
};

export type ModelRoleMapping = { fast: string; reason: string };

export type ModelProbeFailure = {
	modelRef: string;
	reason: string;
};

export type ModelQualificationRejection = {
	modelRef: string;
	reasons: readonly string[];
};

export type RoleMappingDecision =
	| {
			status: "READY";
			mapping: ModelRoleMapping;
			profiles: {
				fast: ModelCapabilityProfile;
				reason: ModelCapabilityProfile;
			};
			evidence: readonly ModelDeploymentEvidence[];
	  }
	| {
			status: "AMBIGUOUS" | "MISSING_ROLE";
			role: "fast" | "reason";
			candidates: readonly string[];
			failures?: readonly ModelProbeFailure[];
			rejections?: readonly ModelQualificationRejection[];
	  };

const REQUIRED_CONTEXT_WINDOW = 16_384;
const REQUIRED_MAX_OUTPUT_TOKENS = 2_048;
function eligibleFast(item: ModelDeploymentEvidence): boolean {
	return (
		item.text &&
		item.vision &&
		item.structuredOutput !== "unsupported" &&
		item.reasoning === "no-thinking" &&
		item.contextWindow >= REQUIRED_CONTEXT_WINDOW &&
		item.maxOutputTokens >= REQUIRED_MAX_OUTPUT_TOKENS
	);
}

function eligibleReason(item: ModelDeploymentEvidence): boolean {
	return (
		item.text &&
		item.structuredOutput !== "unsupported" &&
		item.reasoning === "thinking" &&
		item.contextWindow >= REQUIRED_CONTEXT_WINDOW &&
		item.maxOutputTokens >= REQUIRED_MAX_OUTPUT_TOKENS
	);
}

function rejectionReasons(
	item: ModelDeploymentEvidence,
	role: "fast" | "reason",
): string[] {
	const reasons: string[] = [];
	if (!item.text) reasons.push("不支持文本");
	if (role === "fast" && !item.vision) reasons.push("不支持图像输入");
	if (item.structuredOutput === "unsupported") reasons.push("不支持结构化输出");
	if (role === "fast" && item.reasoning !== "no-thinking")
		reasons.push("不是快速模式");
	if (role === "reason" && item.reasoning !== "thinking")
		reasons.push("没有推理模式");
	if (item.contextWindow < REQUIRED_CONTEXT_WINDOW)
		reasons.push(`上下文小于 ${REQUIRED_CONTEXT_WINDOW}`);
	if (item.maxOutputTokens < REQUIRED_MAX_OUTPUT_TOKENS)
		reasons.push(`最大输出小于 ${REQUIRED_MAX_OUTPUT_TOKENS}`);
	return reasons;
}

function metadataScore(
	item: ModelDeploymentEvidence,
	role: "fast" | "reason",
): number {
	const signals = [item.modelRef, ...(item.metadataSignals ?? [])]
		.join(" ")
		.toLowerCase();
	if (role === "fast")
		return /no[-_ ]?think/.test(signals) ? 2 : /\bfast\b/.test(signals) ? 1 : 0;
	if (/no[-_ ]?think/.test(signals)) return -2;
	return /\b(reason|reasoning|think|thinking)\b/.test(signals) ? 1 : 0;
}

function selectRole(input: {
	role: "fast" | "reason";
	candidates: readonly ModelDeploymentEvidence[];
	previous?: string;
}):
	| { status: "SELECTED"; evidence: ModelDeploymentEvidence }
	| { status: "AMBIGUOUS" | "MISSING_ROLE"; candidates: readonly string[] } {
	if (input.candidates.length === 0)
		return { status: "MISSING_ROLE", candidates: [] };
	const previous = input.candidates.find(
		(candidate) => candidate.modelRef === input.previous,
	);
	if (previous) return { status: "SELECTED", evidence: previous };
	if (input.candidates.length === 1)
		return {
			status: "SELECTED",
			evidence: input.candidates[0] as ModelDeploymentEvidence,
		};
	const ranked = [...input.candidates].sort((left, right) => {
		const difference =
			metadataScore(right, input.role) - metadataScore(left, input.role);
		return difference || left.modelRef.localeCompare(right.modelRef);
	});
	if (
		metadataScore(ranked[0] as ModelDeploymentEvidence, input.role) >
		metadataScore(ranked[1] as ModelDeploymentEvidence, input.role)
	)
		return {
			status: "SELECTED",
			evidence: ranked[0] as ModelDeploymentEvidence,
		};
	return {
		status: "AMBIGUOUS",
		candidates: ranked.map((candidate) => candidate.modelRef).sort(),
	};
}

function profile(
	evidence: ModelDeploymentEvidence,
	role: "fast" | "reason",
): ModelCapabilityProfile {
	return {
		modelRef: evidence.modelRef,
		reasoningModes: [role === "fast" ? "no-thinking" : "thinking"],
		inputModalities:
			role === "fast" || evidence.vision ? ["text", "image"] : ["text"],
		structuredOutput: evidence.structuredOutput,
		contextWindow: evidence.contextWindow,
		maxOutputTokens: evidence.maxOutputTokens,
	};
}

export function decideRoleMapping(
	evidence: readonly ModelDeploymentEvidence[],
	previous?: Partial<ModelRoleMapping>,
): RoleMappingDecision {
	const fast = selectRole({
		role: "fast",
		candidates: evidence.filter(eligibleFast),
		...(previous ? { previous: previous.fast } : {}),
	});
	if (fast.status !== "SELECTED")
		return {
			status: fast.status,
			role: "fast",
			candidates: fast.candidates,
			...(fast.status === "MISSING_ROLE"
				? {
						rejections: evidence.map((item) => ({
							modelRef: item.modelRef,
							reasons: rejectionReasons(item, "fast"),
						})),
					}
				: {}),
		};
	const reason = selectRole({
		role: "reason",
		candidates: evidence.filter(eligibleReason),
		...(previous ? { previous: previous.reason } : {}),
	});
	if (reason.status !== "SELECTED")
		return {
			status: reason.status,
			role: "reason",
			candidates: reason.candidates,
			...(reason.status === "MISSING_ROLE"
				? {
						rejections: evidence.map((item) => ({
							modelRef: item.modelRef,
							reasons: rejectionReasons(item, "reason"),
						})),
					}
				: {}),
		};
	return {
		status: "READY",
		mapping: {
			fast: fast.evidence.modelRef,
			reason: reason.evidence.modelRef,
		},
		profiles: {
			fast: profile(fast.evidence, "fast"),
			reason: profile(reason.evidence, "reason"),
		},
		evidence,
	};
}

export async function verifyAndMapInventory(input: {
	models: readonly { id: string }[];
	probe: (model: { id: string }) => Promise<ModelDeploymentEvidence>;
	previous?: Partial<ModelRoleMapping>;
	cooldownMs?: number;
	sleep?: (milliseconds: number) => Promise<void>;
}): Promise<RoleMappingDecision> {
	const cooldownMs = input.cooldownMs ?? 5_000;
	const sleep =
		input.sleep ??
		((milliseconds: number) =>
			new Promise<void>((resolveSleep) =>
				setTimeout(resolveSleep, milliseconds),
			));
	const evidence: ModelDeploymentEvidence[] = [];
	const failures: ModelProbeFailure[] = [];
	const inventory = [...input.models].sort((left, right) =>
		left.id.localeCompare(right.id),
	);
	for (let index = 0; index < inventory.length; index += 1) {
		const model = inventory[index] as { id: string };
		try {
			evidence.push(await input.probe(model));
		} catch (error) {
			failures.push({
				modelRef: model.id,
				reason: error instanceof Error ? error.message : "能力探测失败",
			});
		}
		if (index < inventory.length - 1 && cooldownMs > 0) await sleep(cooldownMs);
	}
	const decision = decideRoleMapping(evidence, input.previous);
	return decision.status === "READY" || failures.length === 0
		? decision
		: { ...decision, failures };
}

function completionContent(value: unknown): {
	content: string;
	thinking: boolean;
} {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new TypeError("provider completion response is invalid");
	const choices = Reflect.get(value, "choices");
	const first = Array.isArray(choices) ? choices[0] : undefined;
	if (typeof first !== "object" || first === null || Array.isArray(first))
		throw new TypeError("provider completion response is invalid");
	const message = Reflect.get(first, "message");
	if (typeof message !== "object" || message === null || Array.isArray(message))
		throw new TypeError("provider completion response is invalid");
	const content = Reflect.get(message, "content");
	if (typeof content !== "string" || content.length === 0)
		throw new TypeError("provider completion response is invalid");
	const reasoningContent = Reflect.get(message, "reasoning_content");
	const tagged = /^\s*<think>[\s\S]*?<\/think>/i.test(content);
	return {
		content: content.replace(/^\s*<think>[\s\S]*?<\/think>\s*/i, ""),
		thinking:
			tagged ||
			(typeof reasoningContent === "string" && reasoningContent.length > 0),
	};
}

function assertProbeObject(candidate: string): void {
	let parsed: unknown;
	try {
		parsed = JSON.parse(candidate);
	} catch {
		throw new TypeError("structured capability probe failed");
	}
	if (
		typeof parsed !== "object" ||
		parsed === null ||
		Array.isArray(parsed) ||
		Reflect.get(parsed, "probe") !== "PASS"
	)
		throw new TypeError("structured capability probe failed");
}

function assertPromptedProbe(content: string): void {
	try {
		assertProbeObject(content);
		return;
	} catch {
		// A single whole-response JSON fence is accepted for prompted structured
		// output. Arbitrary prose around JSON remains invalid/fail-closed.
	}
	const fenced = content.match(/^\s*```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/i);
	if (!fenced?.[1]) throw new TypeError("structured capability probe failed");
	assertProbeObject(fenced[1]);
}

export function createOpenAIModelDeploymentProbe(input: {
	baseUrl: string;
	credential?: string;
	fetch?: typeof fetch;
	timeoutMs?: number;
	cooldownMs?: number;
	sleep?: (milliseconds: number) => Promise<void>;
	now?: () => string;
}) {
	const fetchImplementation = input.fetch ?? globalThis.fetch;
	const timeoutMs = input.timeoutMs ?? 30_000;
	const cooldownMs = input.cooldownMs ?? 5_000;
	const sleep =
		input.sleep ??
		((milliseconds: number) =>
			new Promise<void>((resolveSleep) =>
				setTimeout(resolveSleep, milliseconds),
			));
	const now = input.now ?? (() => new Date().toISOString());
	const baseUrl = input.baseUrl.replace(/\/+$/, "");
	const endpoint = `${baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`}/chat/completions`;
	const invoke = async (body: Record<string, unknown>) => {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const response = await fetchImplementation(endpoint, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					...(input.credential
						? { authorization: `Bearer ${input.credential}` }
						: {}),
				},
				body: JSON.stringify(body),
				signal: controller.signal,
			});
			if (!response.ok)
				throw new Error(`capability probe returned HTTP ${response.status}`);
			return completionContent(await response.json());
		} catch (error) {
			throw new Error(
				error instanceof Error
					? error.message
					: "provider capability probe failed",
			);
		} finally {
			clearTimeout(timer);
		}
	};
	return async (model: {
		id: string;
		object?: string;
		ownedBy?: string;
	}): Promise<ModelDeploymentEvidence> => {
		const contextPrompt = [
			"Return exactly one JSON object with probe set to PASS.",
			"x".repeat(REQUIRED_CONTEXT_WINDOW),
		].join("\n");
		const nativeBody = {
			model: model.id,
			messages: [{ role: "user", content: contextPrompt }],
			response_format: { type: "json_object" },
			max_tokens: REQUIRED_MAX_OUTPUT_TOKENS,
			temperature: 0,
			stream: false,
		};
		let text: Awaited<ReturnType<typeof invoke>>;
		let structuredOutput: "native" | "prompted";
		try {
			text = await invoke(nativeBody);
			assertProbeObject(text.content);
			structuredOutput = "native";
		} catch {
			if (cooldownMs > 0) await sleep(cooldownMs);
			text = await invoke({
				model: model.id,
				messages: [{ role: "user", content: contextPrompt }],
				max_tokens: REQUIRED_MAX_OUTPUT_TOKENS,
				temperature: 0,
				stream: false,
			});
			assertPromptedProbe(text.content);
			structuredOutput = "prompted";
		}
		let vision = false;
		if (!text.thinking) {
			if (cooldownMs > 0) await sleep(cooldownMs);
			try {
				const image = await invoke({
					model: model.id,
					messages: [
						{
							role: "user",
							content: [
								{
									type: "text",
									text: 'Return exactly {"probe":"PASS"} after accepting this image.',
								},
								{
									type: "image_url",
									image_url: {
										url: `data:image/png;base64,${VISION_CAPABILITY_PROBE_PNG}`,
									},
								},
							],
						},
					],
					...(structuredOutput === "native"
						? { response_format: { type: "json_object" } }
						: {}),
					max_tokens: 128,
					temperature: 0,
					stream: false,
				});
				if (structuredOutput === "native") assertProbeObject(image.content);
				else assertPromptedProbe(image.content);
				vision = true;
			} catch {
				vision = false;
			}
		}
		return {
			modelRef: model.id,
			text: true,
			vision,
			structuredOutput,
			reasoning: text.thinking ? "thinking" : "no-thinking",
			contextWindow: REQUIRED_CONTEXT_WINDOW,
			maxOutputTokens: REQUIRED_MAX_OUTPUT_TOKENS,
			verifiedAt: now(),
			metadataSignals: [model.object, model.ownedBy].filter(
				(signal): signal is string => typeof signal === "string",
			),
		};
	};
}

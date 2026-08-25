import type { ModelCapabilityProfile } from "@tomflow/proflow-model-contracts";

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
	  };

const REQUIRED_CONTEXT_WINDOW = 16_384;
const REQUIRED_MAX_OUTPUT_TOKENS = 2_048;
const ONE_PIXEL_PNG =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

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
	const inventory = [...input.models].sort((left, right) =>
		left.id.localeCompare(right.id),
	);
	for (let index = 0; index < inventory.length; index += 1) {
		const model = inventory[index] as { id: string };
		try {
			evidence.push(await input.probe(model));
		} catch {
			// A failed candidate remains ineligible; other inventory candidates still run.
		}
		if (index < inventory.length - 1 && cooldownMs > 0) await sleep(cooldownMs);
	}
	return decideRoleMapping(evidence, input.previous);
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

function assertStructuredProbe(content: string): void {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
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
			if (error instanceof TypeError) throw error;
			throw new Error("provider capability probe failed");
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
		const text = await invoke({
			model: model.id,
			messages: [{ role: "user", content: contextPrompt }],
			response_format: { type: "json_object" },
			max_tokens: REQUIRED_MAX_OUTPUT_TOKENS,
			temperature: 0,
			stream: false,
		});
		assertStructuredProbe(text.content);
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
										url: `data:image/png;base64,${ONE_PIXEL_PNG}`,
									},
								},
							],
						},
					],
					response_format: { type: "json_object" },
					max_tokens: 128,
					temperature: 0,
					stream: false,
				});
				assertStructuredProbe(image.content);
				vision = true;
			} catch {
				vision = false;
			}
		}
		return {
			modelRef: model.id,
			text: true,
			vision,
			structuredOutput: "native",
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

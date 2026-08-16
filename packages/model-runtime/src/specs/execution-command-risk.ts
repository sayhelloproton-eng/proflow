import { createReasoningSpec } from "@tomflow/proflow-model-contracts";
import { z } from "zod";

const boundedPrimitive = z.union([
	z.string().max(2_000),
	z.number(),
	z.boolean(),
	z.null(),
]);

const boundedOperation = z
	.record(
		z.string().min(1).max(160),
		z.union([boundedPrimitive, z.array(boundedPrimitive).max(32)]),
	)
	.refine(
		(value) => Object.keys(value).length <= 96,
		"command-risk accepts at most 96 bounded operation facts",
	);

export const executionCommandRiskSpec = createReasoningSpec({
	id: "execution.command-risk",
	version: "1.0.0",
	purpose:
		"FAST-first risk classification for one bounded Execution command; REASON is an escalation path and Human Approval remains caller-owned",
	allowedModes: ["fast", "reason", "auto"],
	requiredModalities: ["text"],
	inputSchema: z
		.object({
			capability: z.string().min(1).max(160),
			inputFingerprint: z.string().regex(/^sha256:/),
			callerRef: z.string().min(1).max(240),
			taskId: z.string().min(1).max(240).optional(),
			nodeId: z.string().min(1).max(240).optional(),
			roleRef: z.string().min(1).max(240).optional(),
			workerRef: z.string().min(1).max(240).optional(),
			projectRoot: z.string().min(1).max(1_000).optional(),
			operation: boundedOperation,
		})
		.strict(),
	outputSchema: z
		.object({
			decision: z.enum(["ALLOW", "DENY", "ESCALATE"]),
			reasonCode: z.string().min(1).max(160),
			confidence: z.number().min(0).max(1),
			rationale: z.string().min(1).max(1_000),
		})
		.strict(),
	instruction: [
		"Classify only the supplied bounded Execution command facts.",
		"Hard deterministic Policy and Owner facts outrank this model output.",
		"Return ALLOW only when the bounded command is sufficiently understood and permitted for the caller-owned policy to continue.",
		"Return DENY for a bounded command that should not execute.",
		"Return ESCALATE when uncertainty, ambiguous side effects, or missing evidence requires stronger reasoning or Human Approval.",
		"Never execute an effect, grant Approval, mutate Task or Execution facts, or infer authority from confidence.",
		"Return exactly one JSON object matching the required output schema.",
	].join(" "),
	maxContextBytes: 12_288,
	maxOutputTokens: 512,
	repair: "once",
	routing: {
		startRole: "fast",
		allowReasonEscalation: true,
		escalateDecisions: ["ESCALATE"],
	},
});

import { createReasoningSpec } from "@tomflow/proflow-model-contracts";
import { z } from "zod";

const diagnosticFactValue = z.union([
	z.string().max(1_000),
	z.number(),
	z.boolean(),
	z.null(),
]);

export const taskDiagnosticSpec = createReasoningSpec({
	id: "task.diagnostic",
	version: "1.0.0",
	purpose:
		"Low-frequency REASON diagnostic for one Task/run when deterministic owner facts cannot safely explain ambiguity, UNKNOWN reality, repeated recovery failure, or an unexplained stall",
	allowedModes: ["reason"],
	requiredModalities: ["text"],
	inputSchema: z
		.object({
			taskId: z.string().min(1),
			nodeId: z.string().min(1),
			runNo: z.number().int().positive(),
			anomaly: z
				.object({
					kind: z.enum([
						"FACT_CONFLICT",
						"UNKNOWN_REALITY",
						"STALLED",
						"RECOVERY_FAILED",
					]),
					ref: z.string().min(1),
					facts: z
						.record(z.string().min(1).max(120), diagnosticFactValue)
						.refine(
							(value) => Object.keys(value).length <= 64,
							"Task Diagnostic accepts at most 64 bounded facts",
						),
				})
				.strict(),
		})
		.strict(),
	outputSchema: z
		.object({
			finding: z.string().min(1).max(1_000),
			probableCause: z.string().min(1).max(1_000),
			confidence: z.number().min(0).max(1),
			recommendedNextObservation: z.string().min(1).max(1_000),
			recommendedRecoveryAction: z.string().min(1).max(1_000),
			needsHumanAttention: z.boolean(),
		})
		.strict(),
	instruction: [
		"Diagnose only the supplied bounded facts for one Task/run.",
		"This is a read-only advisory path for ambiguity, UNKNOWN reality, repeated recovery failure, or unexplained stall.",
		"Do not complete, reopen, approve, retry, replay, or otherwise mutate Task, Execution, Agent, or Carrier facts.",
		"Never convert confidence into authority. Recommend the next observation or recovery action only.",
		"Return exactly one JSON object matching the required output schema.",
	].join(" "),
	maxContextBytes: 8_192,
	maxOutputTokens: 1_024,
	repair: "once",
	routing: {
		startRole: "reason",
		allowReasonEscalation: false,
		escalateDecisions: [],
	},
});

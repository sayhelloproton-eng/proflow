import { createReasoningSpec } from "@tomflow/proflow-model-contracts";
import { z } from "zod";

export const systemHealthAssessmentSpec = createReasoningSpec({
	id: "system.health-assessment",
	version: "1.0.0",
	purpose:
		"Classify deterministic system health facts into a bounded operational state",
	allowedModes: ["fast", "reason", "auto"],
	requiredModalities: ["text"],
	inputSchema: z
		.object({
			service: z.string().min(1),
			checks: z
				.array(
					z
						.object({
							name: z.string().min(1),
							state: z.enum(["PASS", "WARN", "FAIL", "UNKNOWN"]),
						})
						.strict(),
				)
				.min(1),
		})
		.strict(),
	outputSchema: z
		.object({
			decision: z.enum(["HEALTHY", "DEGRADED", "UNAVAILABLE", "ESCALATE"]),
			confidence: z.number().min(0).max(1),
			reasonCode: z.enum([
				"ALL_CHECKS_PASS",
				"WARNINGS_PRESENT",
				"FAILURE_PRESENT",
				"FACTS_INSUFFICIENT",
			]),
			rationale: z.string().min(1).max(240),
		})
		.strict(),
	instruction: [
		"Use only the supplied checks.",
		"All PASS => HEALTHY/ALL_CHECKS_PASS.",
		"Any FAIL => UNAVAILABLE/FAILURE_PRESENT.",
		"No FAIL and any WARN => DEGRADED/WARNINGS_PRESENT.",
		"Any UNKNOWN that prevents classification => ESCALATE/FACTS_INSUFFICIENT.",
		"Return decision, confidence, reasonCode, and a short rationale.",
	].join(" "),
	maxContextBytes: 16_384,
	maxOutputTokens: 192,
	repair: "once",
	routing: {
		startRole: "fast",
		allowReasonEscalation: true,
		escalateDecisions: ["ESCALATE"],
	},
});

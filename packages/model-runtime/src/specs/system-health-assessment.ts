import { createReasoningSpec } from "@tomflow/proflow-model-contracts";
import { z } from "zod";

// Bounded System Assessment reasoning spec (MODEL-DOC-03-08).
//
// The System Observer caller projects Owner facts into eight read-only,
// sanitized concern-family views before invoking `infer(priority=background)`.
// Raw secrets, entire-repository dumps, complete source listings, and complete
// log payloads must never enter the default snapshot: only bounded summaries,
// finding/risk text, and evidence references are admissible here. Batching,
// carry-forward, drill-down, and global-synthesis orchestration stay with the
// caller; this spec only evaluates one bounded input at a time.
//
// The lightweight `service`/`checks` shape is retained as the deterministic
// capability-verification probe used by the model-runtime process on startup.

const boundedViewSchema = z
	.object({
		summary: z.string().min(1).max(2_000),
		health: z.enum(["HEALTHY", "DEGRADED", "ACTION_REQUIRED", "UNKNOWN"]),
		findings: z.array(z.string().min(1).max(500)).max(64).optional(),
		evidenceRefs: z.array(z.string().min(1)).max(64).optional(),
	})
	.strict();

const probeCheckSchema = z
	.object({
		name: z.string().min(1),
		state: z.enum(["PASS", "WARN", "FAIL", "UNKNOWN"]),
	})
	.strict();

const carryForwardItemSchema = z
	.object({
		hypothesis: z.string().min(1).max(500),
		risk: z.string().min(1).max(500).optional(),
		evidenceRef: z.string().min(1).optional(),
		confidence: z.number().min(0).max(1),
	})
	.strict();

export const systemHealthAssessmentSpec = createReasoningSpec({
	id: "system.health-assessment",
	version: "1.0.0",
	purpose:
		"Bounded System Assessment over eight concern-family views (task, worker, collaboration, execution, carrier, model, deployment, artifact) plus a deterministic capability probe",
	allowedModes: ["fast", "reason", "auto"],
	requiredModalities: ["text"],
	inputSchema: z
		.object({
			// Deterministic capability probe (model-runtime process startup).
			service: z.string().min(1).optional(),
			checks: z.array(probeCheckSchema).min(1).optional(),
			// Bounded System Assessment input (MODEL-DOC-03-08 §3).
			observedAt: z.iso.datetime().optional(),
			views: z
				.object({
					task: boundedViewSchema,
					worker: boundedViewSchema,
					collaboration: boundedViewSchema,
					execution: boundedViewSchema,
					carrier: boundedViewSchema,
					model: boundedViewSchema,
					deployment: boundedViewSchema,
					artifact: boundedViewSchema,
				})
				.strict()
				.optional(),
			previousUnresolved: z
				.array(z.string().min(1).max(500))
				.max(64)
				.optional(),
			previousCarryForward: z.array(carryForwardItemSchema).max(64).optional(),
		})
		.strict()
		.superRefine((value, context) => {
			const hasProbe =
				value.service !== undefined && value.checks !== undefined;
			if (!hasProbe && value.views === undefined) {
				context.addIssue({
					code: "custom",
					message: "System Assessment requires views or a capability probe",
				});
			}
		}),
	outputSchema: z
		.object({
			// Deterministic capability-probe verdict (model-runtime process startup).
			decision: z
				.enum(["HEALTHY", "DEGRADED", "UNAVAILABLE", "ESCALATE"])
				.optional(),
			reasonCode: z
				.enum([
					"ALL_CHECKS_PASS",
					"WARNINGS_PRESENT",
					"FAILURE_PRESENT",
					"FACTS_INSUFFICIENT",
				])
				.optional(),
			// Bounded System Assessment verdict (MODEL-DOC-03-08 §5).
			scope: z.string().min(1).max(240).optional(),
			health: z
				.enum(["HEALTHY", "DEGRADED", "ACTION_REQUIRED", "UNKNOWN"])
				.optional(),
			findings: z.array(z.string().min(1).max(500)).max(128).optional(),
			risks: z.array(z.string().min(1).max(500)).max(128).optional(),
			anomalies: z.array(z.string().min(1).max(500)).max(128).optional(),
			hypotheses: z.array(z.string().min(1).max(500)).max(128).optional(),
			unresolved: z.array(z.string().min(1).max(500)).max(128).optional(),
			needsDrilldown: z.array(z.string().min(1).max(500)).max(128).optional(),
			evidenceRefs: z.array(z.string().min(1)).max(128).optional(),
			carryForward: z.array(carryForwardItemSchema).max(64).optional(),
			confidence: z.number().min(0).max(1),
			rationale: z.string().min(1).max(240),
		})
		.strict(),
	instruction: [
		"Assess the supplied bounded System Assessment views.",
		"Inputs are read-only, caller-projected snapshots across eight concern families: task, worker, collaboration, execution, carrier, model, deployment, and artifact.",
		"Never request or infer raw secrets, entire repository contents, complete source listings, or complete log payloads; only bounded summaries, findings, risks, and evidence references are admissible.",
		"When a deterministic capability probe (service/checks) is supplied, return decision, reasonCode, confidence, and rationale.",
		"When System Assessment views are supplied, return scope, health, findings, risks, anomalies, hypotheses, unresolved, needsDrilldown, evidenceRefs, carryForward, confidence, and rationale.",
		"Return exactly one JSON object matching the required output schema.",
	].join(" "),
	maxContextBytes: 16_384,
	maxOutputTokens: 2_048,
	repair: "once",
	routing: {
		startRole: "fast",
		allowReasonEscalation: true,
		escalateDecisions: ["ESCALATE"],
	},
});

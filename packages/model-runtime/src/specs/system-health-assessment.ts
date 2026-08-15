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
		health: z.enum(["HEALTHY", "DEGRADED", "CRITICAL", "UNKNOWN"]),
		projectionStatus: z
			.enum(["AVAILABLE", "LIMITED", "UNAVAILABLE"])
			.optional(),
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

const derivedAssessmentSchema = z
	.object({
		scope: z.string().min(1).max(240),
		observedAt: z.iso.datetime(),
		health: z.enum(["HEALTHY", "DEGRADED", "CRITICAL", "UNKNOWN"]),
		findings: z.array(z.string().min(1).max(500)).max(128),
		risks: z.array(z.string().min(1).max(500)).max(128),
		anomalies: z.array(z.string().min(1).max(500)).max(128),
		hypotheses: z.array(z.string().min(1).max(500)).max(128),
		unresolved: z.array(z.string().min(1).max(500)).max(128),
		needsDrilldown: z.array(z.string().min(1).max(500)).max(128),
		evidenceRefs: z.array(z.string().min(1)).max(128),
		confidence: z.number().min(0).max(1),
		carryForward: z.array(carryForwardItemSchema).max(64),
		rationale: z.string().min(1).max(240),
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
			assessmentKind: z
				.enum(["CONCERN_BATCH", "DRILLDOWN", "GLOBAL_SYNTHESIS"])
				.optional(),
			scope: z.string().min(1).max(240).optional(),
			views: z
				.partialRecord(
					z.enum([
						"task",
						"worker",
						"collaboration",
						"execution",
						"carrier",
						"model",
						"deployment",
						"artifact",
					]),
					boundedViewSchema,
				)
				.refine(
					(value) => Object.keys(value).length > 0,
					"at least one bounded view is required",
				)
				.optional(),
			previousUnresolved: z
				.array(z.string().min(1).max(500))
				.max(64)
				.optional(),
			previousCarryForward: z.array(carryForwardItemSchema).max(64).optional(),
			batchAssessments: z.array(derivedAssessmentSchema).max(16).optional(),
			drilldown: z
				.array(
					z
						.object({
							topic: z.string().min(1).max(240),
							data: boundedViewSchema,
						})
						.strict(),
				)
				.max(32)
				.optional(),
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
			health: z.enum(["HEALTHY", "DEGRADED", "CRITICAL", "UNKNOWN"]).optional(),
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
		"When System Assessment views are supplied, assess only the supplied bounded concern views; assessmentKind/scope identify concern-batch, drill-down, or global-synthesis caller orchestration.",
		"Return scope, health, findings, risks, anomalies, hypotheses, unresolved, needsDrilldown, evidenceRefs, carryForward, confidence, and rationale.",
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

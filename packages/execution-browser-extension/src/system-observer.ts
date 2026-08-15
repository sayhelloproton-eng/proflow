/**
 * System Observer: lowest-priority, read-only system assessment orchestration.
 *
 * Owner domains project bounded snapshots. This caller groups them into concern
 * batches, carries unresolved findings forward explicitly, requests targeted
 * drill-down only when the assessment asks for it, and performs one final
 * global synthesis. It never mutates owner facts and it never owns model
 * scheduling or business state.
 */

export const SYSTEM_OBSERVER_VIEWS = [
	"task",
	"worker",
	"collaboration",
	"execution",
	"carrier",
	"model",
	"deployment",
	"artifact",
] as const;

export type SystemObserverView = (typeof SYSTEM_OBSERVER_VIEWS)[number];
export type SystemObserverPriority = "BACKGROUND" | "LOWEST" | "DEFERRED";
export type SystemObserverHealth =
	| "HEALTHY"
	| "DEGRADED"
	| "CRITICAL"
	| "UNKNOWN";

export interface SystemObserverCarryForwardItem {
	hypothesis: string;
	risk?: string;
	evidenceRef?: string;
	confidence: number;
}

export interface SystemObserverAssessment {
	scope: string;
	observedAt: string;
	health: SystemObserverHealth;
	findings: string[];
	risks: string[];
	anomalies: string[];
	hypotheses: string[];
	unresolved: string[];
	needsDrilldown: string[];
	evidenceRefs: string[];
	confidence: number;
	carryForward: SystemObserverCarryForwardItem[];
	rationale: string;
}

export interface SystemObserverSnapshotPort {
	readView(view: SystemObserverView): Promise<unknown>;
	readDrilldown?(request: {
		topic: string;
		views: readonly SystemObserverView[];
	}): Promise<unknown>;
}

export interface SystemObserverReasonRequest {
	assessmentRef: string;
	kind: "CONCERN_BATCH" | "DRILLDOWN" | "GLOBAL_SYNTHESIS";
	scope: string;
	observedAt: string;
	views: Partial<Record<SystemObserverView, unknown>>;
	previousUnresolved: string[];
	previousCarryForward: SystemObserverCarryForwardItem[];
	batchAssessments?: SystemObserverAssessment[];
	drilldown?: Array<{ topic: string; data: unknown }>;
}

export interface SystemObserverReasonResult
	extends Omit<SystemObserverAssessment, "scope" | "observedAt"> {
	scope?: string;
}

export interface SystemObserverResult {
	assessmentRef: string;
	priority: SystemObserverPriority;
	observedAt: string;
	assessments: SystemObserverAssessment[];
	drilldown: Array<{ topic: string; data: unknown }>;
	global: SystemObserverAssessment | null;
	status: "ASSESSED" | "DEFERRED";
	errorCode?: "REASON_UNAVAILABLE" | "REASON_FAILED";
}

const DEFAULT_CONCERN_BATCHES: ReadonlyArray<{
	scope: string;
	views: readonly SystemObserverView[];
}> = [
	{ scope: "task-worker", views: ["task", "worker"] },
	{ scope: "execution-approval", views: ["execution", "artifact"] },
	{ scope: "collaboration-carrier", views: ["collaboration", "carrier"] },
	{ scope: "model-deployment-health", views: ["model", "deployment"] },
];

function normalizeAssessment(
	result: SystemObserverReasonResult,
	scope: string,
	observedAt: string,
): SystemObserverAssessment {
	return {
		scope: result.scope ?? scope,
		observedAt,
		health: result.health,
		findings: [...result.findings],
		risks: [...result.risks],
		anomalies: [...result.anomalies],
		hypotheses: [...result.hypotheses],
		unresolved: [...result.unresolved],
		needsDrilldown: [...result.needsDrilldown],
		evidenceRefs: [...result.evidenceRefs],
		confidence: result.confidence,
		carryForward: result.carryForward.map((item) => ({ ...item })),
		rationale: result.rationale,
	};
}

export function createSystemObserver(options: {
	snapshots: SystemObserverSnapshotPort;
	reason?: (
		input: SystemObserverReasonRequest,
	) => Promise<SystemObserverReasonResult>;
	idFactory?: () => string;
	now?: () => Date;
}) {
	const priority: SystemObserverPriority = "LOWEST";
	const now = options.now ?? (() => new Date());
	const idFactory = options.idFactory ?? (() => crypto.randomUUID());

	const readViews = async (views: readonly SystemObserverView[]) => {
		const entries = await Promise.all(
			views.map(
				async (view) => [view, await options.snapshots.readView(view)] as const,
			),
		);
		return Object.fromEntries(entries) as Partial<
			Record<SystemObserverView, unknown>
		>;
	};

	const synthesize = async (input?: {
		previousUnresolved?: string[];
		previousCarryForward?: SystemObserverCarryForwardItem[];
	}): Promise<SystemObserverResult> => {
		const observedAt = now().toISOString();
		const assessmentRef = `assessment:${idFactory()}`;
		const previousUnresolved = [...(input?.previousUnresolved ?? [])];
		const previousCarryForward = (input?.previousCarryForward ?? []).map(
			(item) => ({ ...item }),
		);

		if (!options.reason) {
			return {
				assessmentRef,
				priority: "DEFERRED",
				observedAt,
				assessments: [],
				drilldown: [],
				global: null,
				status: "DEFERRED",
				errorCode: "REASON_UNAVAILABLE",
			};
		}

		try {
			const assessments: SystemObserverAssessment[] = [];
			for (const batch of DEFAULT_CONCERN_BATCHES) {
				const views = await readViews(batch.views);
				const result = await options.reason({
					assessmentRef,
					kind: "CONCERN_BATCH",
					scope: batch.scope,
					observedAt,
					views,
					previousUnresolved,
					previousCarryForward,
				});
				assessments.push(normalizeAssessment(result, batch.scope, observedAt));
			}

			const topics = [
				...new Set(assessments.flatMap((item) => item.needsDrilldown)),
			];
			const drilldown: Array<{ topic: string; data: unknown }> = [];
			if (options.snapshots.readDrilldown) {
				for (const topic of topics) {
					drilldown.push({
						topic,
						data: await options.snapshots.readDrilldown({
							topic,
							views: SYSTEM_OBSERVER_VIEWS,
						}),
					});
				}
			}

			const topLevelViews = await readViews(SYSTEM_OBSERVER_VIEWS);
			const globalResult = await options.reason({
				assessmentRef,
				kind: "GLOBAL_SYNTHESIS",
				scope: "global",
				observedAt,
				views: topLevelViews,
				previousUnresolved,
				previousCarryForward,
				batchAssessments: assessments,
				drilldown,
			});
			const global = normalizeAssessment(globalResult, "global", observedAt);

			return {
				assessmentRef,
				priority,
				observedAt,
				assessments,
				drilldown,
				global,
				status: "ASSESSED",
			};
		} catch {
			return {
				assessmentRef,
				priority: "DEFERRED",
				observedAt,
				assessments: [],
				drilldown: [],
				global: null,
				status: "DEFERRED",
				errorCode: "REASON_FAILED",
			};
		}
	};

	return Object.freeze({ synthesize });
}

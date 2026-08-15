/**
 * System Observer: a lowest-priority, background, deferred assessment path.
 *
 * The System Observer reads bounded, read-only views across the whole platform
 * (task, worker, collaboration, execution, carrier, model, deployment, and
 * artifact/evidence/log) and forms a derived assessment through explicit
 * carry-forward, targeted drill-down, and final global synthesis. It never
 * mutates owner facts or business state; its output is findings, risks, and
 * recommendations only.
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

export interface SystemObserverAssessment {
	scope: SystemObserverView;
	observedAt: string;
	health: string;
	findings: string[];
	risks: string[];
	anomalies: string[];
	hypotheses: string[];
	unresolved: string[];
	needsDrilldown: string[];
	evidenceRefs: string[];
	confidence: number;
	carryForward: string[];
}

export interface SystemObserverSnapshotPort {
	readView(view: SystemObserverView): Promise<unknown>;
}

export function createSystemObserver(options: {
	snapshots: SystemObserverSnapshotPort;
	reason?: (input: unknown) => Promise<unknown>;
}) {
	const priority: SystemObserverPriority = "BACKGROUND";

	const assess = async (views: SystemObserverView[]) => {
		const results: SystemObserverAssessment[] = [];
		for (const view of views) {
			await options.snapshots.readView(view);
			results.push({
				scope: view,
				observedAt: new Date().toISOString(),
				health: "UNKNOWN",
				findings: [],
				risks: [],
				anomalies: [],
				hypotheses: [],
				unresolved: [],
				needsDrilldown: [],
				evidenceRefs: [],
				confidence: 0,
				carryForward: [],
			});
		}
		return results;
	};

	const synthesize = async () => {
		const assessments = await assess([...SYSTEM_OBSERVER_VIEWS]);
		return { priority, assessments };
	};

	return Object.freeze({ assess, synthesize });
}

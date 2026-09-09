import {
	decideTaskProgression,
	type TaskDriveProjection,
	type TaskResumeSignal,
} from "./task-observer.ts";

export type ReconciliationCoordinatorOptions = {
	listTaskIds(): Promise<string[]>;
	listExecutionSignals(): Promise<unknown[]>;
	acknowledgeExecutionSignal(signalRef: string): Promise<void>;
	ensureWorkers(taskId: string): Promise<void>;
	getProjection(taskId: string): Promise<TaskDriveProjection>;
	requestWake(input: {
		taskId: string;
		nodeId: string;
		runNo: number;
		roleRef: string;
		workerRef: string;
		trigger: string;
		conversationLocator: string;
		underlyingRef?: string;
	}): Promise<unknown>;
	intervalMs?: number;
	pageSize?: number;
	concurrency?: number;
	now?: () => number;
};

type FailureState = { attempt: number; nextAt: number };

export function createReconciliationCoordinator(
	options: ReconciliationCoordinatorOptions,
) {
	const intervalMs = options.intervalMs ?? 10_000;
	const pageSize = options.pageSize ?? 100;
	const concurrency = options.concurrency ?? 4;
	const now = options.now ?? Date.now;
	let cursor = 0;
	let stopped = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let sweepInFlight: Promise<void> | null = null;
	const taskInFlight = new Map<string, Promise<void>>();
	const pendingSignals = new Map<string, TaskResumeSignal>();
	const failures = new Map<string, FailureState>();
	const appliedIntents = new Map<string, string>();

	const intentKey = (decision: {
		taskId: string;
		nodeId: string;
		runNo: number;
		trigger: string;
		underlyingRef?: string;
	}) =>
		`${decision.taskId}:${decision.nodeId}:${decision.runNo}:${decision.trigger}:${decision.underlyingRef ?? "none"}`;

	const markFailure = (taskId: string) => {
		const previous = failures.get(taskId)?.attempt ?? 0;
		const attempt = Math.min(previous + 1, 8);
		const delay = Math.min(30_000, 500 * 2 ** Math.max(0, attempt - 1));
		failures.set(taskId, { attempt, nextAt: now() + delay });
	};
	const clearFailure = (taskId: string) => failures.delete(taskId);
	const canAttempt = (taskId: string) =>
		(failures.get(taskId)?.nextAt ?? 0) <= now();

	const reconcileOnce = async (taskId: string): Promise<void> => {
		if (!canAttempt(taskId)) return;
		try {
			let projection = await options.getProjection(taskId);
			if (projection.terminal) {
				appliedIntents.delete(taskId);
				clearFailure(taskId);
				return;
			}
			await options.ensureWorkers(taskId);
			projection = await options.getProjection(taskId);
			const signal = pendingSignals.get(taskId);
			pendingSignals.delete(taskId);
			const decision = decideTaskProgression(projection, signal);
			if (decision.kind !== "WAKE") {
				if (decision.kind === "STOP_DRIVING") appliedIntents.delete(taskId);
				clearFailure(taskId);
				return;
			}
			const key = intentKey(decision);
			if (appliedIntents.get(taskId) === key) {
				clearFailure(taskId);
				return;
			}

			await options.requestWake(decision);
			appliedIntents.set(taskId, key);
			clearFailure(taskId);
		} catch {
			markFailure(taskId);
			throw new Error("TASK_RECONCILIATION_FAILED");
		}
	};

	const reconcile = (
		taskId: string,
		signal?: TaskResumeSignal,
	): Promise<void> => {
		if (signal) pendingSignals.set(taskId, signal);
		const current = taskInFlight.get(taskId);
		if (current) return current;
		const run = reconcileOnce(taskId)
			.catch(() => undefined)
			.finally(() => {
				taskInFlight.delete(taskId);
				if (pendingSignals.has(taskId) && !stopped) void reconcile(taskId);
			});
		taskInFlight.set(taskId, run);
		return run;
	};

	const processExecutionSignal = async (raw: unknown) => {
		if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return;
		const signal = raw as Record<string, unknown>;
		if (typeof signal.signalRef !== "string") return;
		if (signal.kind === "UNKNOWN_REALITY") {
			// UNKNOWN remains durable on the Execution record. Consuming this one-shot
			// notification never replays the effect and prevents queue starvation.
			await options.acknowledgeExecutionSignal(signal.signalRef);
			return;
		}
		if (signal.kind !== "RECOVERY_RESUME") return;
		if (
			typeof signal.executionRef !== "string" ||
			typeof signal.taskId !== "string" ||
			typeof signal.workerRef !== "string"
		)
			return;
		if (typeof signal.nodeId !== "string" || !Number.isInteger(signal.runNo)) {
			await options.acknowledgeExecutionSignal(signal.signalRef);
			return;
		}
		const resumeSignal: TaskResumeSignal = {
			trigger: "RECOVERY_RESUME",
			ref: signal.executionRef,
			targetWorkerRef: signal.workerRef,
			nodeId: signal.nodeId,
			runNo: Number(signal.runNo),
		};
		await reconcile(signal.taskId, resumeSignal);
		const projection = await options.getProjection(signal.taskId);
		const decision = decideTaskProgression(projection, resumeSignal);
		if (decision.kind === "STOP_DRIVING") {
			await options.acknowledgeExecutionSignal(signal.signalRef);
			return;
		}
		if (decision.kind === "WAKE") {
			if (appliedIntents.get(signal.taskId) === intentKey(decision))
				await options.acknowledgeExecutionSignal(signal.signalRef);
			return;
		}
		if (
			decision.reason !== "BINDING_NOT_READY" &&
			decision.reason !== "RESUME_TARGET_NOT_CURRENT_WORKER"
		)
			await options.acknowledgeExecutionSignal(signal.signalRef);
	};
	const processExecutionSignals = async () => {
		const signals = (await options.listExecutionSignals()).slice(0, 100);
		for (let index = 0; index < signals.length; index += concurrency)
			await Promise.all(
				signals
					.slice(index, index + concurrency)
					.map((signal) =>
						processExecutionSignal(signal).catch(() => undefined),
					),
			);
	};

	const runPage = async (taskIds: string[]) => {
		for (let index = 0; index < taskIds.length; index += concurrency) {
			const batch = taskIds.slice(index, index + concurrency);
			await Promise.all(batch.map((taskId) => reconcile(taskId)));
		}
	};
	const sweep = (): Promise<void> => {
		if (stopped) return Promise.resolve();
		if (sweepInFlight) return sweepInFlight;
		sweepInFlight = (async () => {
			await processExecutionSignals().catch(() => undefined);
			const taskIds = await options.listTaskIds();
			if (taskIds.length === 0) {
				cursor = 0;
				return;
			}
			if (cursor >= taskIds.length) cursor = 0;
			const page = taskIds.slice(cursor, cursor + pageSize);
			cursor = (cursor + page.length) % taskIds.length;
			await runPage(page);
		})()
			.catch(() => undefined)
			.finally(() => {
				sweepInFlight = null;
			});
		return sweepInFlight;
	};

	const schedule = () => {
		if (stopped) return;
		timer = setTimeout(() => {
			void sweep().finally(schedule);
		}, intervalMs);
		timer.unref?.();
	};
	return Object.freeze({
		start() {
			if (stopped) throw new Error("RECONCILIATION_COORDINATOR_STOPPED");
			void sweep();
			schedule();
		},
		kick(taskId: string, signal?: TaskResumeSignal) {
			if (stopped) return;
			void reconcile(taskId, signal);
		},
		reconcile,
		sweep,
		stop() {
			stopped = true;
			if (timer) clearTimeout(timer);
			pendingSignals.clear();
			failures.clear();
			appliedIntents.clear();
		},
	});
}

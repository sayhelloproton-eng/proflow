import {
	decideTaskProgression,
	type TaskDriveProjection,
	type TaskResumeSignal,
} from "./task-observer.ts";

export type ReconciliationCoordinatorOptions = {
	listTaskPage(input: {
		afterTaskId?: string;
		limit: number;
	}): Promise<{ taskIds: string[]; nextAfterTaskId?: string }>;
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
	maxPendingTasks?: number;
	maxPendingSignals?: number;
	now?: () => number;
};

type FailureState = { attempt: number; nextAt: number };

function positiveBound(
	value: number | undefined,
	fallback: number,
	max: number,
) {
	if (value === undefined) return fallback;
	if (!Number.isInteger(value) || value < 1 || value > max)
		throw new RangeError(`reconciliation bound must be between 1 and ${max}`);
	return value;
}

export function createReconciliationCoordinator(
	options: ReconciliationCoordinatorOptions,
) {
	const intervalMs = positiveBound(options.intervalMs, 10_000, 60_000);
	const pageSize = positiveBound(options.pageSize, 100, 1_000);
	const concurrency = positiveBound(options.concurrency, 4, 64);
	const maxPendingTasks = positiveBound(options.maxPendingTasks, 1_024, 10_000);
	const maxPendingSignals = positiveBound(
		options.maxPendingSignals,
		4_096,
		50_000,
	);
	const now = options.now ?? Date.now;
	let taskCursor: string | undefined;
	let stopped = false;
	let started = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let sweepInFlight: Promise<void> | null = null;
	let activeReconciliations = 0;
	let pendingSignalCount = 0;
	const slotWaiters: Array<(acquired: boolean) => void> = [];
	const admittedTasks = new Set<string>();
	const taskInFlight = new Map<string, Promise<void>>();
	const pendingSignals = new Map<string, Map<string, TaskResumeSignal>>();
	const failures = new Map<string, FailureState>();
	const appliedIntents = new Map<string, Set<string>>();
	const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

	const acquireSlot = async (): Promise<boolean> => {
		if (stopped) return false;
		if (activeReconciliations < concurrency) {
			activeReconciliations += 1;
			return true;
		}
		return new Promise<boolean>((resolve) => slotWaiters.push(resolve));
	};
	const releaseSlot = () => {
		const next = stopped ? undefined : slotWaiters.shift();
		if (next) next(true);
		else activeReconciliations = Math.max(0, activeReconciliations - 1);
	};
	const intentKey = (decision: {
		taskId: string;
		nodeId: string;
		runNo: number;
		workerRef: string;
		trigger: string;
		underlyingRef?: string;
	}) =>
		JSON.stringify([
			decision.taskId,
			decision.nodeId,
			decision.runNo,
			decision.workerRef,
			decision.trigger,
			decision.underlyingRef ?? null,
		]);
	const signalKey = (signal: TaskResumeSignal) =>
		JSON.stringify([
			signal.trigger,
			signal.ref,
			signal.targetWorkerRef,
			signal.nodeId,
			signal.runNo,
		]);
	const hasApplied = (taskId: string, key: string) =>
		appliedIntents.get(taskId)?.has(key) === true;
	const rememberApplied = (taskId: string, key: string) => {
		const keys = appliedIntents.get(taskId) ?? new Set<string>();
		keys.add(key);
		// This is only a bounded cache. Execution owns durable effect deduplication.
		if (keys.size > 128) {
			const oldest = keys.values().next().value;
			if (oldest !== undefined) keys.delete(oldest);
		}
		appliedIntents.set(taskId, keys);
	};
	const consumePendingSignal = (taskId: string, signal?: TaskResumeSignal) => {
		if (!signal) return;
		const signals = pendingSignals.get(taskId);
		if (signals?.delete(signalKey(signal))) pendingSignalCount -= 1;
		if (signals?.size === 0) pendingSignals.delete(taskId);
	};
	const clearPendingSignals = (taskId: string) => {
		pendingSignalCount -= pendingSignals.get(taskId)?.size ?? 0;
		pendingSignals.delete(taskId);
	};
	const markFailure = (taskId: string) => {
		const attempt = Math.min((failures.get(taskId)?.attempt ?? 0) + 1, 8);
		const delay = Math.min(30_000, 500 * 2 ** Math.max(0, attempt - 1));
		failures.set(taskId, { attempt, nextAt: now() + delay });
	};
	const canAttempt = (taskId: string) =>
		(failures.get(taskId)?.nextAt ?? 0) <= now();
	const schedulePendingRetry = (taskId: string) => {
		if (
			stopped ||
			(!pendingSignals.has(taskId) && !failures.has(taskId)) ||
			retryTimers.has(taskId)
		)
			return;
		const delay = Math.max(1, (failures.get(taskId)?.nextAt ?? now()) - now());
		const retry = setTimeout(() => {
			retryTimers.delete(taskId);
			if (!stopped) void reconcile(taskId);
		}, delay);
		retry.unref?.();
		retryTimers.set(taskId, retry);
	};
	const retainable = (reason: string) =>
		reason === "BINDING_NOT_READY" ||
		reason === "RESUME_TARGET_NOT_CURRENT_WORKER";

	const reconcileOnce = async (taskId: string): Promise<void> => {
		if (stopped || !canAttempt(taskId)) return;
		try {
			let projection = await options.getProjection(taskId);
			if (stopped) return;
			if (projection.terminal) {
				clearPendingSignals(taskId);
				appliedIntents.delete(taskId);
				failures.delete(taskId);
				return;
			}
			await options.ensureWorkers(taskId);
			if (stopped) return;
			projection = await options.getProjection(taskId);
			if (stopped) return;
			const signals = pendingSignals.get(taskId);
			const signal = signals?.values().next().value;
			const decision = decideTaskProgression(projection, signal);
			if (decision.kind === "STOP_DRIVING") {
				clearPendingSignals(taskId);
				appliedIntents.delete(taskId);
				failures.delete(taskId);
				return;
			}
			if (decision.kind === "NOOP") {
				if (signal && retainable(decision.reason)) {
					// Retain blocked intent, rotating it so another signal can progress.
					const key = signalKey(signal);
					signals?.delete(key);
					signals?.set(key, signal);
					markFailure(taskId);
				} else {
					consumePendingSignal(taskId, signal);
					failures.delete(taskId);
				}
				return;
			}
			const key = intentKey(decision);
			if (!hasApplied(taskId, key)) {
				await options.requestWake(decision);
				if (stopped) return;
				rememberApplied(taskId, key);
			}
			consumePendingSignal(taskId, signal);
			failures.delete(taskId);
		} catch {
			if (!stopped) markFailure(taskId);
		}
	};

	const reconcile = (
		taskId: string,
		signal?: TaskResumeSignal,
	): Promise<void> => {
		if (stopped) return Promise.resolve();
		const signals = pendingSignals.get(taskId);
		const key = signal ? signalKey(signal) : undefined;
		if (!admittedTasks.has(taskId) && admittedTasks.size >= maxPendingTasks)
			throw new Error("TASK_RECONCILIATION_CAPACITY_EXCEEDED");
		if (key && !signals?.has(key) && pendingSignalCount >= maxPendingSignals)
			throw new Error("TASK_RECONCILIATION_SIGNAL_CAPACITY_EXCEEDED");
		admittedTasks.add(taskId);
		if (signal && key && !signals?.has(key)) {
			const queue = signals ?? new Map<string, TaskResumeSignal>();
			queue.set(key, signal);
			pendingSignals.set(taskId, queue);
			pendingSignalCount += 1;
		}
		const retry = retryTimers.get(taskId);
		if (retry) {
			clearTimeout(retry);
			retryTimers.delete(taskId);
		}
		const current = taskInFlight.get(taskId);
		if (current) return current;
		const run = (async () => {
			if (!(await acquireSlot())) return;
			try {
				await reconcileOnce(taskId);
			} finally {
				releaseSlot();
			}
		})().finally(() => {
			taskInFlight.delete(taskId);
			if (
				!stopped &&
				(pendingSignals.has(taskId) || failures.has(taskId))
			)
				schedulePendingRetry(taskId);
			else admittedTasks.delete(taskId);
		});
		taskInFlight.set(taskId, run);
		return run;
	};

	const processExecutionSignal = async (raw: unknown) => {
		if (
			stopped ||
			typeof raw !== "object" ||
			raw === null ||
			Array.isArray(raw)
		)
			return;
		const signal = raw as Record<string, unknown>;
		if (typeof signal.signalRef !== "string") return;
		if (signal.kind === "UNKNOWN_REALITY") {
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
		if (
			typeof signal.nodeId !== "string" ||
			!Number.isInteger(signal.runNo) ||
			Number(signal.runNo) <= 0
		) {
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
		if (stopped) return;
		const projection = await options.getProjection(signal.taskId);
		if (stopped) return;
		const decision = decideTaskProgression(projection, resumeSignal);
		if (
			decision.kind === "STOP_DRIVING" ||
			(decision.kind === "WAKE" &&
				hasApplied(signal.taskId, intentKey(decision))) ||
			(decision.kind === "NOOP" && !retainable(decision.reason))
		)
			await options.acknowledgeExecutionSignal(signal.signalRef);
	};
	const processExecutionSignals = async () => {
		if (stopped) return;
		const signals = (await options.listExecutionSignals()).slice(0, 100);
		for (
			let index = 0;
			!stopped && index < signals.length;
			index += concurrency
		)
			await Promise.all(
				signals
					.slice(index, index + concurrency)
					.map((signal) =>
						processExecutionSignal(signal).catch(() => undefined),
					),
			);
	};
	const sweep = (): Promise<void> => {
		if (stopped) return Promise.resolve();
		if (sweepInFlight) return sweepInFlight;
		sweepInFlight = (async () => {
			await processExecutionSignals().catch(() => undefined);
			if (stopped) return;
			let page = await options.listTaskPage({
				...(taskCursor ? { afterTaskId: taskCursor } : {}),
				limit: pageSize,
			});
			if (stopped) return;
			if (page.taskIds.length === 0 && taskCursor !== undefined) {
				taskCursor = undefined;
				page = await options.listTaskPage({ limit: pageSize });
				if (stopped) return;
			}
			taskCursor = page.nextAfterTaskId;
			// A page uses the same bounded admission and slots as kicks and retries.
			for (
				let index = 0;
				!stopped && index < page.taskIds.length;
				index += concurrency
			)
				await Promise.all(
					page.taskIds.slice(index, index + concurrency).map(async (taskId) => {
						await reconcile(taskId);
					}),
				);
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
			if (started) return;
			started = true;
			void sweep();
			schedule();
		},
		kick(taskId: string, signal?: TaskResumeSignal) {
			// Capacity errors are synchronous: never report acceptance after dropping intent.
			void reconcile(taskId, signal);
		},
		reconcile,
		sweep,
		stop() {
			if (stopped) return;
			stopped = true;
			if (timer) clearTimeout(timer);
			for (const retry of retryTimers.values()) clearTimeout(retry);
			retryTimers.clear();
			for (const waiter of slotWaiters.splice(0)) waiter(false);
			pendingSignals.clear();
			pendingSignalCount = 0;
			admittedTasks.clear();
			failures.clear();
			appliedIntents.clear();
		},
	});
}

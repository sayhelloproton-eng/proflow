type RecoveryObservation = {
	url: string;
	contentInstanceId: string;
	pageState: "IDLE" | "BUSY" | "BLOCKED" | "UNKNOWN";
	activityKind: string | null;
};

export async function boundedRecoveryObservation<Value>(
	observe: () => Promise<Value>,
	timeoutMs: number,
): Promise<Value | null> {
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
		throw new TypeError("RECOVERY_OBSERVATION_TIMEOUT_INVALID");
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<null>((resolve) => {
		timer = setTimeout(() => resolve(null), timeoutMs);
	});
	try {
		return await Promise.race([observe().catch(() => null), timeout]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

export function shouldTriggerObserverRecovery(
	previous: RecoveryObservation | undefined,
	current: RecoveryObservation,
): boolean {
	if (current.pageState !== "IDLE") return false;
	if (!previous) return true;
	return (
		previous.pageState !== "IDLE" ||
		previous.url !== current.url ||
		previous.contentInstanceId !== current.contentInstanceId ||
		previous.activityKind !== current.activityKind
	);
}

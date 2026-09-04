type RecoveryObservation = {
	url: string;
	contentInstanceId: string;
	pageState: "IDLE" | "BUSY" | "BLOCKED" | "UNKNOWN";
	activityKind: string | null;
};

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

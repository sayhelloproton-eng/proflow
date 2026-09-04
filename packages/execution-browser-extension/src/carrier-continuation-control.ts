export type CarrierContinuationDenial = {
	attentionRef: string;
	tabId: number;
	taskId: string | null;
	roleRef: string | null;
	workerRef: string | null;
	url: string;
	contentInstanceId: string;
	permissionFingerprint: string;
};

export type CarrierRecoveryObservation = {
	tabId: number;
	url: string;
	contentInstanceId?: string;
	pageState: "IDLE" | "BUSY" | "BLOCKED" | "UNKNOWN";
	blockerFacts?: { fingerprint: string };
};

function parseDenials(value: unknown): CarrierContinuationDenial[] | null {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.length > 128) return null;
	const parsed: CarrierContinuationDenial[] = [];
	for (const item of value) {
		if (typeof item !== "object" || item === null || Array.isArray(item))
			return null;
		const attentionRef = Reflect.get(item, "attentionRef");
		const tabId = Reflect.get(item, "tabId");
		const taskId = Reflect.get(item, "taskId");
		const roleRef = Reflect.get(item, "roleRef");
		const workerRef = Reflect.get(item, "workerRef");
		const url = Reflect.get(item, "url");
		const contentInstanceId = Reflect.get(item, "contentInstanceId");
		const permissionFingerprint = Reflect.get(item, "permissionFingerprint");
		if (
			typeof attentionRef !== "string" ||
			!Number.isInteger(tabId) ||
			(taskId !== null && typeof taskId !== "string") ||
			(roleRef !== null && typeof roleRef !== "string") ||
			(workerRef !== null && typeof workerRef !== "string") ||
			typeof url !== "string" ||
			typeof contentInstanceId !== "string" ||
			typeof permissionFingerprint !== "string"
		)
			return null;
		parsed.push({
			attentionRef,
			tabId: tabId as number,
			taskId,
			roleRef,
			workerRef,
			url,
			contentInstanceId,
			permissionFingerprint,
		});
	}
	return parsed;
}

export function createCarrierContinuationControl(initial?: unknown) {
	const byTab = new Map<number, CarrierContinuationDenial>();

	const load = (value: unknown): boolean => {
		const denials = parseDenials(value);
		byTab.clear();
		if (!denials) return false;
		for (const denial of denials) byTab.set(denial.tabId, denial);
		return true;
	};
	if (initial !== undefined) load(initial);

	return Object.freeze({
		beginDenied(denial: CarrierContinuationDenial): void {
			byTab.set(denial.tabId, { ...denial });
		},
		cancelDenied(attentionRef: string): boolean {
			for (const [tabId, denial] of byTab)
				if (denial.attentionRef === attentionRef) return byTab.delete(tabId);
			return false;
		},
		consumeRecovery(
			previous: CarrierRecoveryObservation | undefined,
			current: CarrierRecoveryObservation,
		): CarrierContinuationDenial | null {
			const denial = byTab.get(current.tabId);
			if (!denial) return null;
			if (
				denial.url !== current.url ||
				denial.contentInstanceId !== current.contentInstanceId
			) {
				byTab.delete(current.tabId);
				return null;
			}
			if (current.pageState !== "IDLE") return null;
			if (
				previous &&
				(previous.tabId !== denial.tabId ||
					previous.url !== denial.url ||
					previous.contentInstanceId !== denial.contentInstanceId ||
					previous.pageState !== "BLOCKED" ||
					previous.blockerFacts?.fingerprint !== denial.permissionFingerprint)
			) {
				byTab.delete(current.tabId);
				return null;
			}
			byTab.delete(current.tabId);
			return { ...denial };
		},
		suppressRecovery(
			previous: CarrierRecoveryObservation | undefined,
			current: CarrierRecoveryObservation,
		): boolean {
			return this.consumeRecovery(previous, current) !== null;
		},
		snapshot(): CarrierContinuationDenial[] {
			return [...byTab.values()].map((denial) => ({ ...denial }));
		},
		load,
	});
}

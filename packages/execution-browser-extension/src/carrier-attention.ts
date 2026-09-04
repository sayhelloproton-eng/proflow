export type CarrierAttentionAction = "allowOnce" | "deny";

export type CarrierAttention = {
	attentionRef: string;
	occurrenceRef: string;
	tabId: number;
	contentInstanceId: string;
	url: string;
	permissionFingerprint: string;
	taskId: string | null;
	roleRef: string | null;
	workerRef: string | null;
	targetHost: string | null;
	operationId: string;
	reason: string;
	actions: CarrierAttentionAction[];
	observedAt: string;
};

export type CarrierAttentionInput = Omit<
	CarrierAttention,
	"attentionRef" | "occurrenceRef"
>;

export function createCarrierAttentionRegistry(
	idFactory: () => string = () => crypto.randomUUID(),
) {
	const byTab = new Map<number, CarrierAttention>();

	return Object.freeze({
		derive(input: CarrierAttentionInput): CarrierAttention {
			const current = byTab.get(input.tabId);
			if (
				current?.contentInstanceId === input.contentInstanceId &&
				current.url === input.url &&
				current.permissionFingerprint === input.permissionFingerprint
			) {
				const refreshed = { ...current, ...input };
				byTab.set(input.tabId, refreshed);
				return refreshed;
			}
			const occurrenceRef = idFactory();
			const attention: CarrierAttention = {
				...input,
				occurrenceRef,
				attentionRef: `carrier-attention:${input.tabId}:${occurrenceRef}`,
			};
			byTab.set(input.tabId, attention);
			return attention;
		},
		find(attentionRef: string): CarrierAttention | null {
			for (const attention of byTab.values())
				if (attention.attentionRef === attentionRef) return attention;
			return null;
		},
		current(tabId: number): CarrierAttention | null {
			return byTab.get(tabId) ?? null;
		},
		values(): CarrierAttention[] {
			return [...byTab.values()];
		},
		delete(attentionRef: string): boolean {
			for (const [tabId, attention] of byTab)
				if (attention.attentionRef === attentionRef) return byTab.delete(tabId);
			return false;
		},
		removeTab(tabId: number): boolean {
			return byTab.delete(tabId);
		},
	});
}

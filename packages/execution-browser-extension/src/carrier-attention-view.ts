export type CarrierAttentionView = {
	attentionRef: string;
	taskId: string | null;
	roleRef: string | null;
	workerRef: string | null;
	targetHost: string | null;
	operationId: string;
	reason: string;
	actions: Array<"allowOnce" | "deny">;
	observedAt: string;
};

function nullableString(value: unknown): value is string | null {
	return value === null || typeof value === "string";
}

function parseCarrierAttentionView(
	value: unknown,
): CarrierAttentionView | null {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return null;
	const attentionRef = Reflect.get(value, "attentionRef");
	const taskId = Reflect.get(value, "taskId");
	const roleRef = Reflect.get(value, "roleRef");
	const workerRef = Reflect.get(value, "workerRef");
	const targetHost = Reflect.get(value, "targetHost");
	const operationId = Reflect.get(value, "operationId");
	const reason = Reflect.get(value, "reason");
	const actions = Reflect.get(value, "actions");
	const observedAt = Reflect.get(value, "observedAt");
	if (
		typeof attentionRef !== "string" ||
		attentionRef.length === 0 ||
		!nullableString(taskId) ||
		!nullableString(roleRef) ||
		!nullableString(workerRef) ||
		!nullableString(targetHost) ||
		typeof operationId !== "string" ||
		operationId.length === 0 ||
		typeof reason !== "string" ||
		reason.length === 0 ||
		!Array.isArray(actions) ||
		actions.some((action) => action !== "allowOnce" && action !== "deny") ||
		typeof observedAt !== "string" ||
		observedAt.length === 0
	)
		return null;
	return {
		attentionRef,
		taskId,
		roleRef,
		workerRef,
		targetHost,
		operationId,
		reason,
		actions: [...actions],
		observedAt,
	};
}

export function parseCarrierAttentionViews(
	value: unknown,
): CarrierAttentionView[] {
	if (!Array.isArray(value)) return [];
	return value
		.slice(0, 128)
		.map(parseCarrierAttentionView)
		.filter((item): item is CarrierAttentionView => item !== null);
}

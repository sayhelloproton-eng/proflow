import type {
	ActionPermissionFacts,
	PermissionSemanticAction,
} from "./carrier-permission.ts";

export type CarrierPermissionDecision = {
	decision: "AUTO_ALLOW" | "DEFER" | "HUMAN_REQUIRED";
	reason: string;
};

export type CarrierPermissionLifecycleResult =
	| { status: "RELEASED"; action: "allowAlways" | "allow" }
	| { status: "HUMAN_REQUIRED"; reason: string }
	| { status: "STALE" };

export type CarrierPermissionLifecyclePort = {
	classify(): Promise<CarrierPermissionDecision>;
	revalidate(): boolean | Promise<boolean>;
	waitBeforeReclassify?(): Promise<void>;
	act(action: PermissionSemanticAction): Promise<void>;
	released(): Promise<boolean>;
};

export async function resolveRoutineCarrierPermission(input: {
	facts: ActionPermissionFacts;
	autoAlreadyAttempted: boolean;
	maxClassifications?: number;
	humanDenied?: () => boolean;
	port: CarrierPermissionLifecyclePort;
}): Promise<CarrierPermissionLifecycleResult> {
	const denied = (): CarrierPermissionLifecycleResult | null =>
		input.humanDenied?.()
			? { status: "HUMAN_REQUIRED", reason: "HUMAN_DENIED" }
			: null;
	const maxClassifications = Math.max(1, input.maxClassifications ?? 40);
	let decision: CarrierPermissionDecision | null = null;
	for (let attempt = 0; attempt < maxClassifications; attempt += 1) {
		const beforeClassification = denied();
		if (beforeClassification) return beforeClassification;
		try {
			decision = await input.port.classify();
		} catch {
			return {
				status: "HUMAN_REQUIRED",
				reason: "PERMISSION_CLASSIFICATION_FAILED",
			};
		}
		const afterClassification = denied();
		if (afterClassification) return afterClassification;
		if (decision.decision !== "DEFER") break;
		if (!(await input.port.revalidate())) return { status: "STALE" };
		if (attempt === maxClassifications - 1)
			return {
				status: "HUMAN_REQUIRED",
				reason: "PERMISSION_CONTEXT_DEFER_TIMEOUT",
			};
		await input.port.waitBeforeReclassify?.();
	}
	if (!decision)
		return {
			status: "HUMAN_REQUIRED",
			reason: "PERMISSION_CLASSIFICATION_FAILED",
		};
	if (decision.decision !== "AUTO_ALLOW")
		return { status: "HUMAN_REQUIRED", reason: decision.reason };
	const automaticAction = input.facts.actions.includes("allowAlways")
		? "allowAlways"
		: input.facts.actions.includes("allow")
			? "allow"
			: null;
	if (!automaticAction)
		return {
			status: "HUMAN_REQUIRED",
			reason: "AUTO_ALLOW_ACTION_UNAVAILABLE",
		};
	if (input.autoAlreadyAttempted)
		return {
			status: "HUMAN_REQUIRED",
			reason: "AUTO_ALLOW_REALITY_UNCONFIRMED",
		};
	if (!(await input.port.revalidate())) return { status: "STALE" };
	const beforeAction = denied();
	if (beforeAction) return beforeAction;
	try {
		await input.port.act(automaticAction);
	} catch {
		return { status: "HUMAN_REQUIRED", reason: "AUTO_ALLOW_FAILED" };
	}
	return (await input.port.released())
		? { status: "RELEASED", action: automaticAction }
		: { status: "HUMAN_REQUIRED", reason: "AUTO_ALLOW_REALITY_UNCONFIRMED" };
}

export async function resolveHumanCarrierPermission(input: {
	action: "allowOnce" | "deny";
	revalidate(): boolean | Promise<boolean>;
	act(action: "allowOnce" | "deny"): Promise<void>;
	released(): Promise<boolean>;
}): Promise<"RELEASED"> {
	if (!(await input.revalidate())) throw new Error("STALE_PERMISSION");
	await input.act(input.action);
	if (!(await input.released()))
		throw new Error("PERMISSION_ACTION_REALITY_UNCONFIRMED");
	return "RELEASED";
}

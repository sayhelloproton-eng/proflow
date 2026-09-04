import type {
	ActionPermissionFacts,
	PermissionSemanticAction,
} from "./carrier-permission.ts";

export type CarrierPermissionDecision = {
	decision: "AUTO_ALLOW" | "DEFER" | "HUMAN_REQUIRED";
	reason: string;
};

export type CarrierPermissionLifecycleResult =
	| { status: "RELEASED"; action: "allowAlways" }
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
	port: CarrierPermissionLifecyclePort;
}): Promise<CarrierPermissionLifecycleResult> {
	const maxClassifications = Math.max(1, input.maxClassifications ?? 40);
	let decision: CarrierPermissionDecision | null = null;
	for (let attempt = 0; attempt < maxClassifications; attempt += 1) {
		try {
			decision = await input.port.classify();
		} catch {
			return {
				status: "HUMAN_REQUIRED",
				reason: "PERMISSION_CLASSIFICATION_FAILED",
			};
		}
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
	if (!input.facts.actions.includes("allowAlways"))
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
	try {
		await input.port.act("allowAlways");
	} catch {
		return { status: "HUMAN_REQUIRED", reason: "AUTO_ALLOW_FAILED" };
	}
	return (await input.port.released())
		? { status: "RELEASED", action: "allowAlways" }
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

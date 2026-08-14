import type { DeploymentPlan } from "../contracts.ts";

export const SECRET_REDACTED = "<redacted>";

// Redact a flat config map: secretRef slot values become a reference marker so
// the raw value never enters a plan/state DTO, manifest, log, or INSTALL doc.
export function redactSecretValues(
	values: Record<string, string>,
	secretRefs: readonly string[],
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(values)) {
		out[key] = secretRefs.includes(key) ? SECRET_REDACTED : value;
	}
	return out;
}

function redactString(value: string, secrets: readonly string[]): string {
	let out = value;
	for (const secret of secrets) {
		if (secret.length === 0) continue;
		out = out.split(secret).join(SECRET_REDACTED);
	}
	return out;
}

// Deep-structural redaction: returns a clone with every occurrence of a raw
// secret value replaced, in any nested string position.
export function redactDeep(
	value: unknown,
	rawSecrets: readonly string[],
): unknown {
	const secrets = rawSecrets.filter((secret) => secret.length > 0);
	if (typeof value === "string") return redactString(value, secrets);
	if (Array.isArray(value))
		return value.map((item) => redactDeep(item, secrets));
	if (typeof value === "object" && value !== null) {
		const out: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value)) {
			out[key] = redactDeep(item, secrets);
		}
		return out;
	}
	return value;
}

// Derives the secretRef key set from resolvedModules' configSlots and redacts
// those keys in each moduleTarget's config, returning a non-mutating copy.
export function redactPlanSecrets(plan: DeploymentPlan): DeploymentPlan {
	const secretKeys = new Map<string, Set<string>>();
	for (const module of plan.resolvedModules) {
		const keys = new Set<string>();
		for (const slot of module.configSlots) {
			if (slot.type === "secretRef") keys.add(slot.key);
		}
		if (keys.size > 0) secretKeys.set(module.moduleRef, keys);
	}
	const cloned = structuredClone(plan);
	for (const target of cloned.moduleTargets) {
		const keys = secretKeys.get(target.moduleRef);
		if (keys === undefined || target.config === undefined) continue;
		for (const key of keys) {
			if (key in target.config) {
				target.config[key] = SECRET_REDACTED;
			}
		}
	}
	return cloned;
}

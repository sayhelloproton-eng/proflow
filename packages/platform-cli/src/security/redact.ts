import type { DeploymentPlan } from "../contracts.ts";

export const SECRET_REDACTED = "<redacted>";

const SECRET_REF_PATTERN =
	/^(?:secret:\/\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*|credential-ref:[A-Za-z0-9._-]+)$/;

export function isValidSecretRef(value: string): boolean {
	return SECRET_REF_PATTERN.test(value);
}

// secretRef slot values are opaque reference identities (e.g.
// `secret://model-provider/default`, `credential-ref:local-platform`), NOT raw
// tokens/passwords. They are safe to persist and display verbatim, so this
// function preserves them instead of substituting a redaction marker. Raw
// secret leak scanning is `redactDeep`'s job, not this function's.
export function redactSecretValues(
	values: Record<string, string>,
	_secretRefs: readonly string[],
): Record<string, string> {
	return { ...values };
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
// secret value replaced, in any nested string position. This is the leak-scan
// layer for genuine raw secret values (test sentinels or future non-secretRef
// sensitive values). secretRef references are NOT raw secrets and must never be
// passed here as raw secrets.
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

// Plans are public DTOs whose secretRef config values are opaque reference
// identities, not raw secrets. This returns a non-mutating clone that preserves
// secretRef references verbatim (no `<redacted>` substitution).
export function redactPlanSecrets(plan: DeploymentPlan): DeploymentPlan {
	return structuredClone(plan);
}

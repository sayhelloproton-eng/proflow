import type { ResolvedModule } from "../contracts.ts";
import { PlatformError } from "../errors.ts";
import { isValidSecretRef } from "../security/redact.ts";
import type { PreflightFinding } from "./findings.ts";

export interface ResolvedModuleConfig {
	moduleRef: string;
	values: Record<string, string>;
	secretRefs: string[];
	missing: string[];
}

function compareRef(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

export function resolveModuleConfig(
	module: ResolvedModule,
	provided: Record<string, string> | undefined,
): ResolvedModuleConfig {
	const values: Record<string, string> = {};
	const secretRefs: string[] = [];
	const missing: string[] = [];
	for (const slot of module.configSlots) {
		let value = provided?.[slot.key];
		if (value === undefined && slot.default !== undefined) {
			value = String(slot.default);
		}
		if (slot.required && value === undefined) {
			missing.push(slot.key);
			continue;
		}
		if (value === undefined) continue;
		values[slot.key] = value;
		if (slot.type === "secretRef") {
			if (!isValidSecretRef(value))
				throw new PlatformError(
					"SECRET_REF_INVALID",
					`secretRef config "${slot.key}" for ${module.moduleRef} must be an opaque reference identity (e.g. secret://provider/name)`,
				);
			secretRefs.push(slot.key);
		}
	}
	return { moduleRef: module.moduleRef, values, secretRefs, missing };
}

export function checkConfigReadiness(
	modules: readonly ResolvedModule[],
	config: Record<string, Record<string, string>> | undefined,
): PreflightFinding[] {
	const findings: PreflightFinding[] = [];
	const sorted = [...modules].sort((a, b) =>
		compareRef(a.moduleRef, b.moduleRef),
	);
	for (const module of sorted) {
		const resolved = resolveModuleConfig(module, config?.[module.moduleRef]);
		for (const key of resolved.missing) {
			findings.push({
				code: "CONFIG_MISSING",
				severity: "error",
				moduleRef: module.moduleRef,
				message: `missing required config "${key}" for ${module.moduleRef}`,
			});
		}
	}
	return findings;
}

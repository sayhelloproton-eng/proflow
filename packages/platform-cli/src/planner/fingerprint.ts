import { createHash } from "node:crypto";

import type {
	DeploymentPlan,
	DeploymentStep,
	ModuleTarget,
	ResolvedModule,
} from "../contracts.ts";

function compareRef(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function stableStringify(value: unknown): string {
	if (value === null || value === undefined) return "null";
	if (typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) {
		return `[${value.map((item) => stableStringify(item)).join(",")}]`;
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record).sort();
	return `{${keys
		.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
		.join(",")}}`;
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

// Maps each moduleRef to the config keys that hold RAW secret values and must
// be redacted from the fingerprint. secretRef slots are explicitly excluded:
// their values are opaque reference identities (e.g. `secret://…`), which are
// fingerprinted verbatim so a reference change (A→B) changes the fingerprint.
function rawSecretKeyMap(
	modules: readonly ResolvedModule[],
): Map<string, Set<string>> {
	const map = new Map<string, Set<string>>();
	for (const module of modules) {
		const set = new Set<string>();
		for (const slot of module.configSlots) {
			if (slot.type !== "secretRef" && slot.sensitive === true) {
				set.add(slot.key);
			}
		}
		map.set(module.moduleRef, set);
	}
	return map;
}

function canonicalModules(modules: readonly ResolvedModule[]): unknown {
	return [...modules]
		.sort((a, b) => compareRef(a.moduleRef, b.moduleRef))
		.map((module) => ({
			moduleRef: module.moduleRef,
			packageName: module.packageName,
			moduleVersion: module.moduleVersion,
			kind: module.kind,
			provides: [...module.provides]
				.sort((a, b) => compareRef(a.contractRef, b.contractRef))
				.map((provide) => ({
					contractRef: provide.contractRef,
					version: provide.version,
				})),
			requires: [...module.requires]
				.sort((a, b) => compareRef(a.contractRef, b.contractRef))
				.map((require) => ({
					contractRef: require.contractRef,
					versionRange: require.versionRange,
					optional: require.optional ?? false,
				})),
			requirements: [...module.requirements]
				.sort((a, b) => compareRef(stableStringify(a), stableStringify(b)))
				.map((requirement) => requirement),
			configSlots: [...module.configSlots]
				.sort((a, b) => compareRef(a.key, b.key))
				.map((slot) => ({
					key: slot.key,
					type: slot.type,
					required: slot.required,
					sensitive: slot.sensitive ?? false,
					default:
						slot.default === undefined ? null : stableStringify(slot.default),
				})),
			lifecycle: [...module.lifecycle].sort(compareRef),
			verification: [...module.verification.checks]
				.sort((a, b) => compareRef(a.id, b.id))
				.map((check) => ({
					id: check.id,
					lifecycle: check.lifecycle,
					description: check.description,
				})),
			effects: [...module.effects]
				.sort((a, b) =>
					compareRef(
						`${a.kind}:${a.description}`,
						`${b.kind}:${b.description}`,
					),
				)
				.map((effect) => ({
					kind: effect.kind,
					description: effect.description,
				})),
		}));
}

function redactConfig(
	config: Record<string, string>,
	rawSecretKeys: ReadonlySet<string>,
): Record<string, string> {
	const result: Record<string, string> = {};
	for (const key of Object.keys(config).sort()) {
		result[key] = rawSecretKeys.has(key) ? "<redacted>" : (config[key] ?? "");
	}
	return result;
}

function redactedTargets(
	targets: readonly ModuleTarget[],
	rawSecretByRef: ReadonlyMap<string, ReadonlySet<string>>,
): unknown {
	return [...targets]
		.sort((a, b) => compareRef(a.moduleRef, b.moduleRef))
		.map((target) => {
			const rawSecretKeys =
				rawSecretByRef.get(target.moduleRef) ?? new Set<string>();
			const config =
				target.config === undefined
					? null
					: redactConfig(target.config, rawSecretKeys);
			return {
				moduleRef: target.moduleRef,
				targetVersion: target.targetVersion ?? null,
				config,
			};
		});
}

function canonicalSteps(steps: readonly DeploymentStep[]): unknown {
	return steps.map((step) => ({
		stepRef: step.stepRef,
		moduleRef: step.moduleRef,
		kind: step.kind,
		preconditions: [...step.preconditions].sort(compareRef),
		expectedEffect: step.expectedEffect,
		checkStrategy: step.checkStrategy,
		executeStrategy: step.executeStrategy ?? null,
		postcondition: step.postcondition,
	}));
}

export interface FingerprintSource {
	intent: string;
	targets: string;
	modules: string;
	steps: string;
	effects: string;
	humanActions: string;
	verification: string;
}

export function buildFingerprintSource(
	plan: DeploymentPlan,
): FingerprintSource {
	const rawSecretByRef = rawSecretKeyMap(plan.resolvedModules);
	return {
		intent: plan.intent,
		targets: stableStringify(
			redactedTargets(plan.moduleTargets, rawSecretByRef),
		),
		modules: stableStringify(canonicalModules(plan.resolvedModules)),
		steps: stableStringify(canonicalSteps(plan.steps)),
		effects: stableStringify(
			[...plan.effects]
				.sort((a, b) =>
					compareRef(
						`${a.kind}:${a.description}`,
						`${b.kind}:${b.description}`,
					),
				)
				.map((effect) => ({
					kind: effect.kind,
					description: effect.description,
				})),
		),
		humanActions: stableStringify(
			[...plan.humanActions]
				.sort((a, b) => compareRef(a.action, b.action))
				.map((action) => ({
					action: action.action,
					description: action.description,
				})),
		),
		verification: stableStringify(
			[...plan.verification]
				.sort((a, b) => compareRef(a.moduleRef, b.moduleRef))
				.map((verification) => ({
					moduleRef: verification.moduleRef,
					checks: [...verification.checks].sort(compareRef),
				})),
		),
	};
}

export function computeFingerprint(plan: DeploymentPlan): string {
	return sha256(stableStringify(buildFingerprintSource(plan)));
}

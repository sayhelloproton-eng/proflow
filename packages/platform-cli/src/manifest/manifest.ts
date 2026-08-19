import type { ModuleOperationResult } from "@tomflow/proflow-module-contract";

import type {
	PlatformState,
	ResolvedModule,
	VerificationRecord,
} from "../contracts.ts";
import { statusModules } from "../lifecycle/index.ts";
import type { ModuleCatalog } from "../modules.ts";
import type { WorkspacePaths } from "../paths.ts";
import {
	loadConfig,
	loadDeploymentState,
	loadVerificationHistory,
} from "../persistence/index.ts";
import { clearCompletedPendingActions } from "../persistence/state.ts";
import { resolveModuleConfig } from "../preflight/index.ts";
import {
	assessPlatformReady,
	type BlockingAction,
	type ResourceReality,
} from "../ready/index.ts";
import { redactSecretValues } from "../security/index.ts";
import { configFingerprint } from "../verification/index.ts";

export const MANIFEST_CONTRACT = "proflow.manifest.v1";

export interface ManifestModule {
	moduleRef: string;
	packageName: string;
	moduleVersion: string;
	kind: ResolvedModule["kind"];
	source: ResolvedModule["source"];
	provides: ResolvedModule["provides"];
	requires: ResolvedModule["requires"];
	runtimeObserved: boolean;
	runtimeStatus?: ModuleOperationResult["status"];
	runtimeResourceVersion?: string;
	resourceIdentity?: string;
}

export interface ManifestVerification {
	moduleRef: string;
	historyCount: number;
	latest?: VerificationRecord;
	lastPassAt?: string;
	lastFailAt?: string;
}

export interface ManifestConfig {
	moduleRef: string;
	values: Record<string, string>;
	secretRefs: string[];
	missing: string[];
}

export interface ManifestPendingAction {
	moduleRef?: string;
	action: string;
	description?: string;
}

export interface PlatformManifest {
	contract: typeof MANIFEST_CONTRACT;
	observedAt: string;
	status: PlatformState;
	modules: ManifestModule[];
	verification: ManifestVerification[];
	config: ManifestConfig[];
	pendingActions: ManifestPendingAction[];
}

export interface ManifestDeps {
	catalog: ModuleCatalog;
	modules: readonly ResolvedModule[];
	paths: WorkspacePaths;
	config?: Record<string, Record<string, string>>;
	now?: Date;
}

function compareRef(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function lastVerifiedAt(
	records: readonly VerificationRecord[],
	result: "PASS" | "FAIL",
): string | undefined {
	for (let i = records.length - 1; i >= 0; i -= 1) {
		const record = records[i];
		if (record !== undefined && record.result === result) {
			return record.verifiedAt;
		}
	}
	return undefined;
}

/**
 * Dynamically composes the platform manifest from current reality: the resolved
 * module set, module/adapter versions, external resource identity/version, live
 * runtime status (via `statusModules`, never persisted state), provides/requires,
 * secret-redacted config readiness, verification history summary, pending
 * ACTION_REQUIRED, and the aggregated platform status. Every composition carries
 * an explicit `observedAt` freshness timestamp.
 */
export async function buildManifest(
	deps: ManifestDeps,
): Promise<PlatformManifest> {
	const observedAt = (deps.now ?? new Date()).toISOString();
	const modules = [...deps.modules].sort((a, b) =>
		compareRef(a.moduleRef, b.moduleRef),
	);

	const statusResults = await statusModules(deps.catalog, modules);
	const statusByRef = new Map(
		statusResults.map((run) => [run.moduleRef, run] as const),
	);

	const manifestModules: ManifestModule[] = [];
	const verification: ManifestVerification[] = [];
	const configEntries: ManifestConfig[] = [];
	const allRecords: VerificationRecord[] = [];
	const pendingActions: ManifestPendingAction[] = [];
	const blockingActions: BlockingAction[] = [];
	const resources: ResourceReality[] = [];
	const currentVerifiedModuleRefs = new Set<string>();
	const materializedConfig: Record<string, Record<string, string>> = {};

	for (const module of modules) {
		// materialized config current reality (never caller-supplied intent)
		const persisted = await loadConfig(deps.paths, module.moduleRef);
		if (persisted !== undefined) {
			materializedConfig[module.moduleRef] = {
				...persisted.publicValues,
				...persisted.secretValues,
			};
		}

		// live runtime status — current reality, not persisted state
		const run = statusByRef.get(module.moduleRef);
		let runtimeObserved = false;
		let runtimeStatus: ModuleOperationResult["status"] | undefined;
		let runtimeResourceVersion: string | undefined;
		if (
			run !== undefined &&
			run.status === "EXECUTED" &&
			run.result !== undefined
		) {
			runtimeObserved = true;
			runtimeStatus = run.result.status;
			if (run.result.resourceVersion !== undefined) {
				runtimeResourceVersion = run.result.resourceVersion;
			}
			if (
				run.result.status === "ACTION_REQUIRED" &&
				run.result.actionRequired !== undefined
			) {
				const action: ManifestPendingAction = {
					moduleRef: module.moduleRef,
					action: run.result.actionRequired.action,
					description: run.result.actionRequired.description,
				};
				pendingActions.push(action);
				blockingActions.push(action);
			}
		}

		// external resource identity/version
		let resourceIdentity: string | undefined;
		if (module.kind === "external-resource") {
			const secretRefs = module.configSlots
				.filter((slot) => slot.type === "secretRef")
				.map((slot) => slot.key);
			resourceIdentity = configFingerprint(
				persisted?.publicValues ?? {},
				secretRefs,
			);
			resources.push({
				moduleRef: module.moduleRef,
				...(resourceIdentity !== undefined ? { resourceIdentity } : {}),
				...(runtimeResourceVersion !== undefined
					? { resourceVersion: runtimeResourceVersion }
					: {}),
			});
		}

		manifestModules.push({
			moduleRef: module.moduleRef,
			packageName: module.packageName,
			moduleVersion: module.moduleVersion,
			kind: module.kind,
			source: module.source,
			provides: module.provides,
			requires: module.requires,
			runtimeObserved,
			...(runtimeStatus !== undefined ? { runtimeStatus } : {}),
			...(runtimeResourceVersion !== undefined
				? { runtimeResourceVersion }
				: {}),
			...(resourceIdentity !== undefined ? { resourceIdentity } : {}),
		});

		// verification history summary
		const history = await loadVerificationHistory(deps.paths, module.moduleRef);
		allRecords.push(...history);
		const latest = history[history.length - 1];
		if (
			latest?.result === "PASS" &&
			latest.moduleVersion === module.moduleVersion
		) {
			currentVerifiedModuleRefs.add(module.moduleRef);
		}
		const lastPassAt = lastVerifiedAt(history, "PASS");
		const lastFailAt = lastVerifiedAt(history, "FAIL");
		verification.push({
			moduleRef: module.moduleRef,
			historyCount: history.length,
			...(latest !== undefined ? { latest } : {}),
			...(lastPassAt !== undefined ? { lastPassAt } : {}),
			...(lastFailAt !== undefined ? { lastFailAt } : {}),
		});

		// config readiness, secret-redacted, from materialized current reality
		const resolved = resolveModuleConfig(
			module,
			materializedConfig[module.moduleRef],
		);
		configEntries.push({
			moduleRef: module.moduleRef,
			values: redactSecretValues(resolved.values, resolved.secretRefs),
			secretRefs: [...resolved.secretRefs],
			missing: resolved.missing,
		});
	}

	// persisted pending ACTION_REQUIRED blocks readiness unless its plan is COMPLETE
	const deploymentState = await loadDeploymentState(deps.paths);
	if (deploymentState !== undefined) {
		for (const pending of clearCompletedPendingActions(deploymentState)
			.pendingActions) {
			if (currentVerifiedModuleRefs.has(pending.moduleRef)) continue;
			const action: BlockingAction = {
				moduleRef: pending.moduleRef,
				action: pending.action,
				...(pending.description !== undefined
					? { description: pending.description }
					: {}),
			};
			blockingActions.push(action);
			pendingActions.push(action);
		}
	}

	const { state } = assessPlatformReady({
		modules,
		status: statusResults,
		verification: allRecords,
		config: materializedConfig,
		blockingActions,
		resources,
	});

	return {
		contract: MANIFEST_CONTRACT,
		observedAt,
		status: state,
		modules: manifestModules,
		verification,
		config: configEntries,
		pendingActions,
	};
}

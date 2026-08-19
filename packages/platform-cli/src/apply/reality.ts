import type {
	DeploymentPlan,
	DeploymentStep,
	ResolvedModule,
} from "../contracts.ts";
import { dispatchLifecycle } from "../lifecycle/index.ts";
import type { ModuleCatalog } from "../modules.ts";
import type { WorkspacePaths } from "../paths.ts";
import { loadConfig, loadLatestVerification } from "../persistence/index.ts";
import type { StepReality } from "../planner/index.ts";
import type { PackageManagerDriver } from "./driver.ts";

/**
 * Observes the current reality of a single step. The apply loop consults this
 * before every decision so that persisted history can never impersonate current
 * reality; a step that is no longer satisfied is re-executed, never faked as
 * skipped.
 */
export interface RealityObserver {
	observe(
		step: DeploymentStep,
		plan: DeploymentPlan,
	): Promise<StepReality | undefined>;
}

export interface RealityObserverDeps {
	paths: WorkspacePaths;
	catalog: ModuleCatalog;
	driver: PackageManagerDriver;
}

export function createRealityObserver(
	deps: RealityObserverDeps,
): RealityObserver {
	return {
		observe(step, plan) {
			return observeStep(deps, step, plan);
		},
	};
}

function moduleOf(
	plan: DeploymentPlan,
	step: DeploymentStep,
): ResolvedModule | undefined {
	return plan.resolvedModules.find(
		(module) => module.moduleRef === step.moduleRef,
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringMap(value: unknown): value is Record<string, string> {
	if (!isRecord(value)) return false;
	return Object.values(value).every((item) => typeof item === "string");
}

/**
 * Runtime-validates an adapter `status` data payload into a `StepReality` at the
 * boundary. Only recognized fields survive; anything else is ignored so an
 * arbitrary payload can never be mistaken for observed reality. A service
 * `status` payload carrying `state: "RUNNING" | "STOPPED"` maps onto the
 * boolean `processRunning` reality.
 */
function parseStatusReality(value: unknown): StepReality {
	if (!isRecord(value)) return {};
	const reality: StepReality = {};
	if (typeof value.processRunning === "boolean") {
		reality.processRunning = value.processRunning;
	} else if (value.state === "RUNNING") {
		reality.processRunning = true;
	} else if (value.state === "STOPPED") {
		reality.processRunning = false;
	}
	if (typeof value.resourceConfigured === "boolean") {
		reality.resourceConfigured = value.resourceConfigured;
	}
	if (typeof value.humanActionVerified === "boolean") {
		reality.humanActionVerified = value.humanActionVerified;
	}
	if (typeof value.migrated === "boolean") {
		reality.migrated = value.migrated;
	}
	if (typeof value.installedVersion === "string") {
		reality.installedVersion = value.installedVersion;
	}
	if (isStringMap(value.configValues)) {
		reality.configValues = value.configValues;
	}
	return reality;
}

async function observeViaStatus(
	catalog: ModuleCatalog,
	module: ResolvedModule,
): Promise<StepReality | undefined> {
	if (!module.lifecycle.includes("status")) return {};
	try {
		const dispatched = await dispatchLifecycle(catalog, module, "status");
		return parseStatusReality(dispatched.result.data);
	} catch {
		// Observation failed (transport/timeout/malformed): UNKNOWN, never a
		// fabricated NOT_SATISFIED that would replay a lifecycle/external effect.
		return undefined;
	}
}

async function observeStep(
	deps: RealityObserverDeps,
	step: DeploymentStep,
	plan: DeploymentPlan,
): Promise<StepReality | undefined> {
	const module = moduleOf(plan, step);
	if (module === undefined) return {};
	switch (step.kind) {
		case "package": {
			const installedVersion =
				await deps.driver.observeInstalledVersion(module);
			return installedVersion === undefined ? {} : { installedVersion };
		}
		case "config": {
			const config = await loadConfig(deps.paths, step.moduleRef);
			if (config === undefined) return {};
			return {
				configValues: { ...config.publicValues, ...config.secretValues },
			};
		}
		case "lifecycle":
		case "external-resource":
			return observeViaStatus(deps.catalog, module);
		case "human": {
			const statusReality = await observeViaStatus(deps.catalog, module);
			if (statusReality === undefined) return undefined;
			if (statusReality.humanActionVerified === true) return statusReality;
			const latest = await loadLatestVerification(deps.paths, module.moduleRef);
			return {
				...statusReality,
				humanActionVerified:
					latest?.result === "PASS" &&
					latest.moduleVersion === module.moduleVersion,
			};
		}
	}
}

import type { ResolvedModule } from "../contracts.ts";

/**
 * Package-level installation seam. Apply never invokes an arbitrary shell: a
 * package step is satisfied or mutated only through this injected driver, which
 * operates on typed `ResolvedModule` values (and, in a real host, argument
 * arrays) rather than shell strings.
 */
export interface PackageManagerDriver {
	observeInstalledVersion(module: ResolvedModule): Promise<string | undefined>;
	install(module: ResolvedModule): Promise<void>;
	upgrade(module: ResolvedModule): Promise<void>;
}

/**
 * Workspace-resident default: every module in this monorepo already lives at its
 * target version, so the observed installed version always equals the plan
 * target and the package check is satisfied → SKIP. Install/upgrade are no-ops
 * for the same reason.
 */
export function workspaceResidentDriver(): PackageManagerDriver {
	return {
		async observeInstalledVersion(module) {
			return module.moduleVersion;
		},
		async install() {},
		async upgrade() {},
	};
}

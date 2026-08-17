import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { ResolvedModule } from "../contracts.ts";
import {
	managedServiceStatus,
	restartManagedService,
	startManagedService,
	stopManagedService,
} from "../lifecycle/service-process.ts";
import { workspacePaths } from "../paths.ts";

type ResolvedSource = ResolvedModule["source"];

// A bound deployment adapter namespace: exactly the shape the lifecycle
// dispatch boundary already resolves (`namespace.behaviorAdapter`). Keeping the
// binding typed here (instead of `unknown`) stops arbitrary runtime objects
// from being injected into the catalog seam.
export interface DeploymentAdapterBinding {
	behaviorAdapter: Record<string, unknown>;
}

// The adapter-side capability a module may expose so the shipped Platform CLI
// can bind its real service/process/resource at runtime. Inputs are bounded to
// materialized public config only — the adapter (which owns its service/probe
// shape) is responsible for turning that into a real, honest binding.
export type ProductionBindingFactory = (input: {
	moduleRef: string;
	config: Record<string, string>;
	workspaceRoot: string;
	modules: readonly ResolvedModule[];
	configByModuleRef: ReadonlyMap<string, Record<string, string>>;
}) =>
	| Promise<DeploymentAdapterBinding | undefined>
	| DeploymentAdapterBinding
	| undefined;

export type ServiceProcessBindingFactory = (input: {
	moduleRef: string;
	config: Record<string, string>;
	workspaceRoot: string;
	modules: readonly ResolvedModule[];
	configByModuleRef: ReadonlyMap<string, Record<string, string>>;
}) =>
	| Promise<
			| { serviceProcess: unknown; behaviorAdapter?: Record<string, unknown> }
			| undefined
	  >
	| { serviceProcess: unknown; behaviorAdapter?: Record<string, unknown> }
	| undefined;

function managedServiceAdapter(
	workspaceRoot: string,
	module: ResolvedModule,
	serviceProcess: unknown,
	probeAdapter: Record<string, unknown>,
): Record<string, unknown> {
	const paths = workspacePaths(workspaceRoot);
	return {
		...probeAdapter,
		status: () => managedServiceStatus(paths, module),
		start: () => startManagedService(paths, module, serviceProcess),
		stop: () => stopManagedService(paths, module),
		restart: () => restartManagedService(paths, module, serviceProcess),
		uninstall: () => stopManagedService(paths, module),
	};
}

export interface ProductionBindingOptions {
	workspaceRoot: string;
	modules: readonly ResolvedModule[];
	// materialized public+secret config by moduleRef (already loaded by the CLI)
	configByModuleRef: ReadonlyMap<string, Record<string, string>>;
	// dynamic adapter importer. The shipped CLI supplies a real filesystem
	// importer; tests supply a temp-workspace importer. It must return the raw
	// `deployment/adapter.ts` namespace (not a bound adapter).
	importAdapter: (
		packageName: string,
		source: ResolvedSource,
	) => Promise<Record<string, unknown>>;
}

export async function importRawAdapter(
	packageName: string,
	source: ResolvedSource,
): Promise<Record<string, unknown>> {
	if (source.type === "workspace") {
		if (source.path === undefined) return {};
		const url = pathToFileURL(join(source.path, "deployment", "adapter.ts"));
		return (await /* architecture-allow-local-file-url-import */ import(
			url.href
		)) as Record<string, unknown>;
	}
	const resolved = import.meta.resolve(`${packageName}/deployment/adapter`);
	const url = new URL(resolved);
	return (await /* architecture-allow-local-file-url-import */ import(
		url.href
	)) as Record<string, unknown>;
}

/**
 * The shipped Platform CLI production binding factory. For every discovered
 * module it imports the module's own `deployment/adapter.ts` and, when that
 * adapter exposes a `createProductionBinding` factory, invokes it with the
 * module's materialized config to obtain a real bound adapter. A module without
 * a production factory — or whose import/factory fails, or which has no
 * materialized config the adapter accepts — is left out of the map, so the
 * catalog falls back to the module's unbound default, which must fail-closed
 * (ACTION_REQUIRED / NOT_READY). Platform CLI never invents a service or
 * resource reality: it only relays the adapter's own current reality.
 */
export async function buildProductionBindings(
	options: ProductionBindingOptions,
): Promise<ReadonlyMap<string, DeploymentAdapterBinding>> {
	const bindings = new Map<string, DeploymentAdapterBinding>();
	for (const module of options.modules) {
		try {
			const namespace = await options.importAdapter(
				module.packageName,
				module.source,
			);
			const config = options.configByModuleRef.get(module.moduleRef) ?? {};
			const serviceFactory = (
				namespace as { createServiceProcessBinding?: unknown }
			).createServiceProcessBinding;
			if (module.kind === "service" && typeof serviceFactory === "function") {
				const processBinding = await (
					serviceFactory as ServiceProcessBindingFactory
				)({
					moduleRef: module.moduleRef,
					config,
					workspaceRoot: options.workspaceRoot,
					modules: options.modules,
					configByModuleRef: options.configByModuleRef,
				});
				if (processBinding !== undefined) {
					const defaultProbe = (namespace as { behaviorAdapter?: unknown })
						.behaviorAdapter;
					const probeAdapter =
						processBinding.behaviorAdapter ??
						(typeof defaultProbe === "object" && defaultProbe !== null
							? (defaultProbe as Record<string, unknown>)
							: {});
					bindings.set(module.packageName, {
						behaviorAdapter: managedServiceAdapter(
							options.workspaceRoot,
							module,
							processBinding.serviceProcess,
							probeAdapter,
						),
					});
				}
				// A formal service package that exposes the process seam must never fall
				// back to legacy in-memory production binding. Missing config remains
				// unbound and therefore fails closed.
				continue;
			}
			const factory = (namespace as { createProductionBinding?: unknown })
				.createProductionBinding;
			if (typeof factory !== "function") continue;
			const binding = await (factory as ProductionBindingFactory)({
				moduleRef: module.moduleRef,
				config,
				workspaceRoot: options.workspaceRoot,
				modules: options.modules,
				configByModuleRef: options.configByModuleRef,
			});
			if (
				binding !== undefined &&
				typeof binding === "object" &&
				binding !== null &&
				typeof binding.behaviorAdapter === "object" &&
				binding.behaviorAdapter !== null
			) {
				bindings.set(module.packageName, binding);
			}
		} catch {
			// Import/factory failure for one module must not break the rest of the
			// CLI; that module simply remains unbound and fails closed when used.
		}
	}
	return bindings;
}

import type {
	ConfigSlot,
	DeploymentEffect,
	ModuleDescriptor,
	ModuleRequirement,
} from "@tomflow/proflow-module-contract";

export interface ResolvedModule {
	moduleRef: string;
	packageName: string;
	moduleVersion: string;
	kind: ModuleDescriptor["kind"];
	identity: ModuleDescriptor["identity"];
	documentation: ModuleDescriptor["documentation"];
	provides: ModuleDescriptor["provides"];
	requires: ModuleDescriptor["requires"];
	requirements: ModuleRequirement[];
	configSlots: ConfigSlot[];
	lifecycle: string[];
	verification: ModuleDescriptor["verification"];
	effects: DeploymentEffect[];
	source: { type: "workspace" | "installed"; path?: string };
}

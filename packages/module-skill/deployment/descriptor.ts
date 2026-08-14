import { parseModuleDescriptor } from "@tomflow/proflow-module-contract";

export const descriptor = parseModuleDescriptor({
	contract: "module",
	contractVersion: "1.0.0",
	moduleRef: "module-skill",
	packageName: "@tomflow/proflow-module-skill",
	moduleVersion: "0.1.0",
	kind: "library",
	templateVersion: "1.0.0",
	platformCompatibility: ">=1.0.0 <2.0.0",
	provides: [],
	requires: [],
	requirements: [
		{ kind: "runtime", runtime: "node", versionRange: ">=24.19.0" },
	],
	configSlots: [],
	lifecycle: { supported: ["verify"] },
	verification: {
		checks: [
			{
				id: "skill-policy-verify",
				description: "SKILL.md exists and declares frozen-fact-only stop rules",
				lifecycle: "verify",
			},
		],
	},
	effects: [],
});

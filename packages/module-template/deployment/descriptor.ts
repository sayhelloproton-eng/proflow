export const descriptor = {
	contract: "module",
	contractVersion: "1.0.0",
	moduleRef: "module-template",
	packageName: "@tomflow/proflow-module-template",
	moduleVersion: "0.1.1",
	kind: "library",
	templateVersion: "1.0.0",
	platformCompatibility: ">=1.0.0 <2.0.0",
	installClass: "core",
	identity: {
		domain: "deployment-governance",
		summary: "Materializes standard ProFlow module package profiles.",
	},
	provides: [],
	requires: [],
	requirements: [
		{ kind: "runtime", runtime: "node", versionRange: ">=24.19.0" },
	],
	configSlots: [],
	lifecycle: { supported: ["describe", "preflight", "verify", "doctor"] },
	verification: {
		checks: [
			{
				id: "template-tests-pass",
				description: "Module template tests pass",
				lifecycle: "verify",
			},
		],
	},
	effects: [
		{
			kind: "filesystem",
			description: "Materialize a Module in the requested target directory",
			retention: "preserve",
		},
	],
	documentation: [
		{
			id: "overview",
			path: "./README.md",
			description: "Module template package overview",
		},
	],
} as const;

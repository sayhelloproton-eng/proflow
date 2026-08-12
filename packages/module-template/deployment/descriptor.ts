export const descriptor = {
	contract: "module",
	contractVersion: "1.0.0",
	moduleRef: "module-template",
	packageName: "@tomflow/proflow-module-template",
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
		},
	],
} as const;

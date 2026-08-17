export const descriptor = {
	contract: "module",
	contractVersion: "1.0.0",
	moduleRef: "deployment-conformance",
	packageName: "@tomflow/proflow-deployment-conformance",
	moduleVersion: "0.1.1",
	kind: "cli",
	templateVersion: "1.0.0",
	platformCompatibility: ">=1.0.0 <2.0.0",
	installClass: "core",
	identity: {
		domain: "deployment-governance",
		summary:
			"Validates ProFlow module contract, package and behavior conformance.",
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
				id: "conformance-tests-pass",
				description: "Deployment conformance tests pass",
				lifecycle: "verify",
			},
		],
	},
	effects: [],
	documentation: [
		{
			id: "overview",
			path: "./README.md",
			description: "Deployment conformance package overview",
		},
	],
} as const;

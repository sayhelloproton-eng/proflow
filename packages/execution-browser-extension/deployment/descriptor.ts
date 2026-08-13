export const descriptor = {
	contract: "module",
	contractVersion: "1.0.0",
	moduleRef: "execution-browser-extension",
	packageName: "@tomflow/proflow-execution-browser-extension",
	moduleVersion: "0.1.0",
	kind: "browser-extension",
	templateVersion: "1.0.0",
	platformCompatibility: ">=1.0.0 <2.0.0",
	provides: [{ contractRef: "execution-browser-executor", version: "1.0.0" }],
	requires: [
		{ contractRef: "execution", versionRange: ">=1.0.0 <2.0.0" },
		{ contractRef: "task-orchestration", versionRange: ">=1.0.0 <2.0.0" },
		{ contractRef: "agent-runtime", versionRange: ">=1.0.0 <2.0.0" },
	],
	requirements: [
		{ kind: "runtime", runtime: "browser", versionRange: ">=1" },
		{
			kind: "human",
			action:
				"Load and verify the unpacked MV3 extension in the real Chrome profile",
		},
	],
	configSlots: [
		{
			key: "executionRuntimeUrl",
			type: "url",
			required: true,
			description: "Local Execution Runtime public-contract endpoint",
		},
		{
			key: "localPlatformCredential",
			type: "secretRef",
			required: true,
			sensitive: true,
			description: "Extension-scoped local platform credential reference",
		},
	],
	lifecycle: {
		supported: ["describe", "preflight", "status", "verify", "doctor"],
	},
	verification: {
		checks: [
			{
				id: "real-carrier-e3-e4",
				description: "Real Chrome and ChatGPT E3/E4 evidence is present",
				lifecycle: "verify",
			},
		],
	},
	effects: [
		{
			kind: "external-resource",
			description:
				"Package an MV3 extension that performs Execution-authorized Browser effects",
		},
	],
} as const;

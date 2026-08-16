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
			key: "bridge.endpoint",
			type: "url",
			required: true,
			description: "Loopback Browser Reality Bridge endpoint",
		},
		{
			key: "bridge.token",
			type: "secretRef",
			required: true,
			sensitive: true,
			description: "Browser Reality Bridge extension token reference",
		},
		{
			key: "taskApplication.endpoint",
			type: "url",
			required: true,
			description: "Loopback Platform Host Task application endpoint",
		},
		{
			key: "taskApplication.token",
			type: "secretRef",
			required: true,
			sensitive: true,
			description: "Platform Host Task application token reference",
		},
		{
			key: "approvalApplication.endpoint",
			type: "url",
			required: true,
			description: "Loopback Platform Host Approval application endpoint",
		},
		{
			key: "approvalApplication.token",
			type: "secretRef",
			required: true,
			sensitive: true,
			description: "Platform Host Approval application token reference",
		},
		{
			key: "chromeRuntimeModuleRef",
			type: "moduleRef",
			required: false,
			description: "External resource module governing the Chrome runtime",
			default: "chrome-runtime",
		},
		{
			key: "carrierModuleRef",
			type: "moduleRef",
			required: false,
			description: "External resource module governing the Custom GPT carrier",
			default: "chatgpt-carrier",
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

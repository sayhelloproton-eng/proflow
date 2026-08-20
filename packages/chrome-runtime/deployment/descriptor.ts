export const descriptor = {
	contract: "module",
	contractVersion: "1.0.0",
	moduleRef: "chrome-runtime",
	packageName: "@tomflow/proflow-chrome-runtime",
	moduleVersion: "0.1.6",
	kind: "external-resource",
	templateVersion: "1.0.0",
	platformCompatibility: ">=1.0.0 <2.0.0",
	identity: {
		domain: "deployment-governance",
		summary:
			"Observes the real Chrome runtime and MV3 extension load prerequisite.",
	},
	provides: [],
	requires: [],
	requirements: [
		{
			kind: "runtime",
			runtime: "node",
			versionRange: ">=24.19.0",
		},
		{
			kind: "human",
			action:
				"Load and verify the unpacked MV3 extension in the real Chrome profile",
		},
	],
	configSlots: [
		{
			key: "chromeExecutablePath",
			type: "path",
			required: false,
			description:
				"Absolute path to the Chrome/Chromium executable; when unset, probes macOS candidates then PATH commands",
		},
	],
	effects: [
		{
			kind: "external-resource",
			description: "Observes the Chrome runtime and MV3 extension prerequisite",
			retention: "preserve",
		},
	],
	documentation: {
		docs: "DOCS.md",
		setup: "SETUP.md",
	},
} as const;

export const RESOURCE_IDENTITY = "model.provider.api" as const;
export const RESOURCE_IDENTITY_VERSION = "1.0.0" as const;

export const descriptor = {
	contract: "module",
	contractVersion: "1.0.0",
	moduleRef: "model-provider-api",
	packageName: "@tomflow/proflow-model-provider-api",
	moduleVersion: "0.1.3",
	kind: "external-resource",
	templateVersion: "1.0.0",
	platformCompatibility: ">=1.0.0 <2.0.0",
	identity: {
		domain: "deployment-governance",
		summary:
			"Governs and probes the configured OpenAI-compatible model provider API as an external resource.",
	},
	provides: [
		{
			contractRef: "model.provider.api",
			version: "1.0.0",
		},
	],
	requires: [],
	requirements: [
		{
			kind: "runtime",
			runtime: "node",
			versionRange: ">=24.19.0",
		},
	],
	configSlots: [
		{
			key: "providerBaseUrl",
			type: "url",
			required: true,
			description: "OpenAI-compatible provider API base URL",
		},
		{
			key: "providerCredential",
			type: "secretRef",
			required: false,
			sensitive: true,
			description:
				"Optional credential reference; absent for unauthenticated providers",
		},
	],
	lifecycle: {
		supported: ["describe", "preflight", "status", "verify", "doctor"],
	},
	verification: {
		checks: [
			{
				id: "provider-status",
				description: "Provider API reports an observable current status",
				lifecycle: "status",
			},
			{
				id: "provider-reachability",
				description: "Provider API base URL is reachable",
				lifecycle: "verify",
			},
			{
				id: "provider-auth",
				description: "Provider API accepts the configured credential",
				lifecycle: "verify",
			},
			{
				id: "provider-diagnostics",
				description: "Provider configuration has actionable diagnostics",
				lifecycle: "doctor",
			},
		],
	},
	effects: [
		{
			kind: "external-resource",
			description: "Probes the configured OpenAI-compatible model provider API",
			retention: "preserve",
		},
	],
	documentation: [
		{
			id: "overview",
			path: "./README.md",
			description: "Package-owned module overview",
		},
		{
			id: "configuration",
			path: "./CONFIGURATION.md",
			description:
				"Module configuration fields, sources and materialization instructions",
		},
	],
} as const;

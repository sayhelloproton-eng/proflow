export const descriptor = {
	contract: "module",
	contractVersion: "1.0.0",
	moduleRef: "dev-tunnel",
	packageName: "@tomflow/proflow-dev-tunnel",
	moduleVersion: "0.1.6",
	kind: "external-resource",
	templateVersion: "1.0.0",
	platformCompatibility: ">=1.0.0 <2.0.0",
	identity: {
		domain: "deployment-governance",
		summary:
			"Governs the Microsoft Dev Tunnel public HTTPS ingress resource and its managed local host process.",
	},
	provides: [],
	requires: [],
	requirements: [
		{
			kind: "executable",
			command: "devtunnel",
		},
		{
			kind: "human",
			action: "Complete Microsoft Dev Tunnel login when required",
		},
	],
	configSlots: [
		{
			key: "publicBaseUrl",
			type: "url",
			required: true,
			description: "Public HTTPS URL supplied by the dev-tunnel resource",
		},
		{
			key: "tunnelId",
			type: "string",
			required: false,
			description:
				"Persistent Microsoft Dev Tunnel identifier used when this adapter owns lifecycle start/stop",
		},
		{
			key: "verificationEvidenceFile",
			type: "path",
			required: false,
			description:
				"JSON evidence for real file-relay and 429/5xx verification behind the configured public ingress",
		},
	],
	effects: [
		{
			kind: "process",
			description: "Manage the dev-tunnel public ingress process",
			retention: "remove",
		},
		{
			kind: "network",
			description: "Probes the dev-tunnel public HTTPS ingress",
			retention: "preserve",
		},
		{
			kind: "external-resource",
			description: "Exposes the local platform via a public HTTPS tunnel",
			retention: "preserve",
		},
	],
	documentation: {
		docs: "DOCS.md",
		setup: "SETUP.md",
	},
} as const;

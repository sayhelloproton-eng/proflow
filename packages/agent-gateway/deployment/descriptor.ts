export const descriptor = {
	contract: "module",
	contractVersion: "1.0.0",
	moduleRef: "agent-gateway",
	packageName: "@tomflow/proflow-agent-gateway",
	moduleVersion: "0.1.0",
	kind: "service",
	templateVersion: "1.0.0",
	platformCompatibility: ">=1.0.0 <2.0.0",
	provides: [{ contractRef: "custom-gpt-actions-gateway", version: "1.0.0" }],
	requires: [
		{ contractRef: "agent-runtime", versionRange: ">=1.0.0 <2.0.0" },
		{ contractRef: "task-orchestration", versionRange: ">=1.0.0 <2.0.0" },
		{ contractRef: "execution", versionRange: ">=1.0.0 <2.0.0" },
	],
	requirements: [
		{ kind: "runtime", runtime: "node", versionRange: ">=24.19.0" },
		{
			kind: "human",
			action: "Provide the registered dev-tunnel public HTTPS endpoint",
		},
	],
	configSlots: [
		{
			key: "publicBaseUrl",
			type: "url",
			required: true,
			description: "Public HTTPS URL supplied by the dev-tunnel resource",
		},
	],
	lifecycle: {
		supported: [
			"describe",
			"preflight",
			"status",
			"verify",
			"doctor",
			"start",
			"stop",
			"restart",
		],
	},
	verification: {
		checks: [
			{
				id: "gateway-readiness",
				description: "Gateway dependencies and transport guards are ready",
				lifecycle: "verify",
			},
		],
	},
	effects: [
		{ kind: "process", description: "Manage the declared service process" },
	],
} as const;

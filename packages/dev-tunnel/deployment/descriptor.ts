export const descriptor = {
	"contract": "module",
	"contractVersion": "1.0.0",
	"moduleRef": "dev-tunnel",
	"packageName": "@tomflow/proflow-dev-tunnel",
	"moduleVersion": "0.1.5",
	"kind": "external-resource",
	"templateVersion": "1.0.0",
	"platformCompatibility": ">=1.0.0 <2.0.0",
	"identity": {
		"domain": "deployment-governance",
		"summary": "Governs the Microsoft Dev Tunnel public HTTPS ingress resource and its managed local host process."
	},
	"provides": [],
	"requires": [],
	"requirements": [
		{
			"kind": "executable",
			"command": "devtunnel"
		},
		{
			"kind": "human",
			"action": "Complete Microsoft Dev Tunnel login when required"
		}
	],
	"configSlots": [
		{
			"key": "publicBaseUrl",
			"type": "url",
			"required": true,
			"description": "Public HTTPS URL supplied by the dev-tunnel resource"
		},
		{
			"key": "tunnelId",
			"type": "string",
			"required": false,
			"description": "Persistent Microsoft Dev Tunnel identifier used when this adapter owns lifecycle start/stop"
		},
		{
			"key": "verificationEvidenceFile",
			"type": "path",
			"required": false,
			"description": "JSON evidence for real file-relay and 429/5xx verification behind the configured public ingress"
		}
	],
	"lifecycle": {
		"supported": [
			"describe",
			"preflight",
			"status",
			"verify",
			"doctor",
			"start",
			"stop",
			"restart",
			"uninstall"
		]
	},
	"verification": {
		"checks": [
			{
				"id": "tunnel-status",
				"description": "dev-tunnel process reports a real running or stopped state",
				"lifecycle": "status"
			},
			{
				"id": "tunnel-public-ingress",
				"description": "public HTTPS ingress passes the frozen TLS/port/size/latency contract",
				"lifecycle": "verify"
			},
			{
				"id": "tunnel-file-relay",
				"description": "file relay behind the public ingress is reachable",
				"lifecycle": "verify"
			},
			{
				"id": "tunnel-diagnostics",
				"description": "dev-tunnel configuration has actionable diagnostics",
				"lifecycle": "doctor"
			}
		]
	},
	"effects": [
		{
			"kind": "process",
			"description": "Manage the dev-tunnel public ingress process",
			"retention": "remove"
		},
		{
			"kind": "network",
			"description": "Probes the dev-tunnel public HTTPS ingress",
			"retention": "preserve"
		},
		{
			"kind": "external-resource",
			"description": "Exposes the local platform via a public HTTPS tunnel",
			"retention": "preserve"
		}
	],
	"documentation": [
		{
			"id": "overview",
			"path": "./README.md",
			"description": "Dev Tunnel module overview"
		},
		{
			"id": "configuration",
			"path": "./CONFIGURATION.md",
			"description": "Module configuration fields, sources and materialization instructions"
		}
	]
} as const;

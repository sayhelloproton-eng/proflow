export const descriptor = {
	"contract": "module",
	"contractVersion": "1.0.0",
	"moduleRef": "agent-gateway",
	"packageName": "@tomflow/proflow-agent-gateway",
	"moduleVersion": "0.1.3",
	"kind": "service",
	"templateVersion": "1.0.0",
	"platformCompatibility": ">=1.0.0 <2.0.0",
	"identity": {
		"domain": "agent-runtime-collaboration",
		"summary": "The sole Custom GPT Actions HTTP ingress and OpenAI transport anti-corruption layer."
	},
	"provides": [
		{
			"contractRef": "custom-gpt-actions-gateway",
			"version": "1.0.0"
		}
	],
	"requires": [
		{
			"contractRef": "agent-runtime",
			"versionRange": ">=1.0.0 <2.0.0"
		},
		{
			"contractRef": "task-orchestration",
			"versionRange": ">=1.0.0 <2.0.0"
		},
		{
			"contractRef": "execution",
			"versionRange": ">=1.0.0 <2.0.0"
		}
	],
	"requirements": [
		{
			"kind": "runtime",
			"runtime": "node",
			"versionRange": ">=24.19.0"
		}
	],
	"configSlots": [
		{
			"key": "localBaseUrl",
			"type": "url",
			"required": true,
			"description": "Loopback HTTP listener URL owned by Agent Gateway and targeted by the public ingress resource"
		},
		{
			"key": "publicBaseUrl",
			"type": "url",
			"required": true,
			"description": "Public HTTPS URL supplied by the dev-tunnel resource"
		},
		{
			"key": "downstreamCredentialFile",
			"type": "path",
			"required": true,
			"sensitive": true,
			"description": "File containing the dedicated Gateway-to-platform-host transport credential"
		},
		{
			"key": "publicIngressModuleRef",
			"type": "moduleRef",
			"required": false,
			"description": "External resource module governing the public ingress",
			"default": "dev-tunnel"
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
				"id": "gateway-readiness",
				"description": "Gateway dependencies and transport guards are ready",
				"lifecycle": "verify"
			}
		]
	},
	"effects": [
		{
			"kind": "process",
			"description": "Manage the declared service process",
			"retention": "remove"
		}
	],
	"documentation": [
		{
			"id": "overview",
			"path": "./README.md",
			"description": "Agent Gateway package overview"
		},
		{
			"id": "configuration",
			"path": "./CONFIGURATION.md",
			"description": "Module configuration fields, sources and materialization instructions"
		}
	]
} as const;

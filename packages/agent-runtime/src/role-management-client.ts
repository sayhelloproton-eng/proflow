import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { readModuleSharedFacts } from "@tomflow/proflow-module-contract";
import { parse } from "yaml";
import { createAgentRuntime, inspectDurableRoleRegistration } from "./index.ts";

const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function parseLoopbackUrl(value: string) {
	const url = new URL(value);
	if (url.protocol !== "http:" || !loopbackHosts.has(url.hostname))
		throw new Error("PLATFORM_HOST_URL_MUST_BE_LOOPBACK_HTTP");
	return url.href.replace(/\/$/, "");
}

function parseGatewayUrl(value: string) {
	const url = new URL(value);
	const loopbackHttp =
		url.protocol === "http:" && loopbackHosts.has(url.hostname);
	if (url.protocol !== "https:" && !loopbackHttp)
		throw new Error("GATEWAY_URL_MUST_BE_HTTPS_OR_LOOPBACK_HTTP");
	if (url.pathname !== "/" || url.search || url.hash)
		throw new Error("GATEWAY_URL_MUST_BE_ORIGIN_ONLY");
	return url.origin;
}

async function readManagementCredential(stateRoot: string) {
	const path = join(
		resolve(stateRoot),
		"agent",
		"secrets",
		"role-management.token",
	);
	const credential = (await readFile(path, "utf8")).trim();
	if (credential.length < 32)
		throw new Error("ROLE_MANAGEMENT_CREDENTIAL_INVALID");
	return credential;
}

export type RoleManagementClientOptions = {
	platformHostUrl: string;
	stateRoot: string;
};

export type RoleCarrierValidationInput = {
	gatewayUrl: string;
	credential: string;
	openApiText: string;
};

export function validateLocalRoleOpenApi(openApiText: string) {
	const issues: string[] = [];
	let document: unknown;
	try {
		document = parse(openApiText);
	} catch {
		return ["OPENAPI_PARSE_FAILED"];
	}
	if (!document || typeof document !== "object" || Array.isArray(document))
		return ["OPENAPI_DOCUMENT_INVALID"];
	const record = document as Record<string, unknown>;
	if (record.openapi !== "3.1.0") issues.push("OPENAPI_VERSION_INVALID");
	if (
		!record.paths ||
		typeof record.paths !== "object" ||
		Array.isArray(record.paths)
	)
		issues.push("OPENAPI_PATHS_INVALID");
	const components = record.components;
	const bearer =
		components && typeof components === "object" && !Array.isArray(components)
			? Reflect.get(components, "securitySchemes")
			: undefined;
	if (!bearer || typeof bearer !== "object" || Array.isArray(bearer))
		issues.push("OPENAPI_BEARER_AUTH_MISSING");
	else {
		const bearerAuth = Reflect.get(bearer, "bearerAuth");
		if (
			!bearerAuth ||
			typeof bearerAuth !== "object" ||
			Array.isArray(bearerAuth) ||
			Reflect.get(bearerAuth, "type") !== "http" ||
			Reflect.get(bearerAuth, "scheme") !== "bearer"
		)
			issues.push("OPENAPI_BEARER_AUTH_INVALID");
	}
	return issues;
}

export async function validateRoleCarrier(input: RoleCarrierValidationInput) {
	const issues = validateLocalRoleOpenApi(input.openApiText);
	const gatewayUrl = parseGatewayUrl(input.gatewayUrl);
	try {
		const health = await fetch(`${gatewayUrl}/health`, {
			signal: AbortSignal.timeout(5_000),
		});
		if (!health.ok) issues.push(`GATEWAY_HEALTH_HTTP_${health.status}`);
	} catch {
		issues.push("GATEWAY_HEALTH_UNREACHABLE");
	}
	try {
		// getTask is a read-only Action present on all three v1 Role packages. An
		// intentionally missing Task gives the downstream a harmless validation
		// failure while proving that Gateway ingress accepted the role-scoped key.
		const probe = await fetch(
			`${gatewayUrl}/actions/getTask?taskId=__proflow_role_validate_probe__`,
			{
				headers: { authorization: `Bearer ${input.credential}` },
				signal: AbortSignal.timeout(5_000),
			},
		);
		if (probe.status === 401) issues.push("GATEWAY_ROLE_KEY_REJECTED");
		else if (probe.status === 404 || probe.status >= 500)
			issues.push(`GATEWAY_ACTION_PROBE_HTTP_${probe.status}`);
	} catch {
		issues.push("GATEWAY_ACTION_PROBE_UNREACHABLE");
	}
	return {
		status: issues.length === 0 ? ("PASS" as const) : ("FAIL" as const),
		issues,
	};
}

export async function createWorkspaceRoleSetupClient(workspaceRoot: string) {
	const workspace = resolve(workspaceRoot);
	const proflowRoot = join(workspace, ".proflow");
	const runtime = await createAgentRuntime({
		proflowRoot,
		task: {
			async getTask() {
				throw new Error("TASK_API_NOT_AVAILABLE_DURING_ROLE_SETUP");
			},
			async hasNonTerminalRoleUsage() {
				return false;
			},
		},
	});
	return Object.freeze({
		registerRole: (input: unknown) => runtime.registerRole(input),
		inspectRole(input: {
			agentPackageRef: string;
			expectedPackageVersion: string;
		}) {
			return inspectDurableRoleRegistration({ proflowRoot, ...input });
		},
		async gatewayUrl() {
			const facts = await readModuleSharedFacts(
				{ workspaceRoot: workspace },
				"agent-gateway",
			);
			const value = facts?.publicBaseUrl;
			return typeof value === "string" ? value : undefined;
		},
	});
}

export function createRoleManagementClient(
	options: RoleManagementClientOptions,
) {
	const baseUrl = parseLoopbackUrl(options.platformHostUrl);
	const stateRoot = resolve(options.stateRoot);
	return Object.freeze({
		async invoke(operation: string, input: unknown = {}) {
			const credential = await readManagementCredential(stateRoot);
			const response = await fetch(`${baseUrl}/management/agent`, {
				method: "POST",
				signal: AbortSignal.timeout(10_000),
				headers: {
					"content-type": "application/json",
					authorization: `Bearer ${credential}`,
				},
				body: JSON.stringify({ operation, input }),
			});
			const text = await response.text();
			let payload: unknown;
			try {
				payload = text.length === 0 ? null : JSON.parse(text);
			} catch {
				throw new Error(`ROLE_MANAGEMENT_INVALID_RESPONSE:${response.status}`);
			}
			if (!response.ok) {
				const message =
					typeof payload === "object" && payload !== null
						? Reflect.get(payload, "error")
						: undefined;
				throw new Error(
					typeof message === "string"
						? message
						: `ROLE_MANAGEMENT_HTTP_${response.status}`,
				);
			}
			return payload;
		},
	});
}

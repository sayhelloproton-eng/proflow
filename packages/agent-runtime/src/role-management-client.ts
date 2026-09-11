import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { readModuleSharedFacts } from "@tomflow/proflow-module-contract";
import { parse } from "yaml";
import { createAgentRuntime, inspectDurableRoleRegistration } from "./index.ts";

import { compareRoleCarrierMaterial, roleCarrierMaterialFingerprint, type RoleCarrierMaterial } from "./role-carrier-material.ts";
export { compareRoleCarrierMaterial, readExpectedRoleCarrierMaterial, roleCarrierMaterialFingerprint } from "./role-carrier-material.ts";
export type { RoleCarrierMaterial, RoleCarrierMaterialIssue } from "./role-carrier-material.ts";

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
	expectedMaterial?: RoleCarrierMaterial;
	roleRef?: string;
	carrierUrl?: string;
};

export type RoleCarrierValidationEvidenceInput = {
	workspaceRoot: string;
	agentPackageRef: string;
	registeredPackageVersion: string;
	roleRef: string;
	carrierUrl: string;
	gatewayUrl: string;
	expectedMaterial?: RoleCarrierMaterial;
	materialObservation?: unknown;
};

function roleCarrierValidationEvidencePath(
	workspaceRoot: string,
	agentPackageRef: string,
) {
	return join(
		resolve(workspaceRoot),
		".proflow",
		"state",
		"agent",
		"role-carrier-validation",
		`${encodeURIComponent(agentPackageRef)}.json`,
	);
}

export async function inspectRoleCarrierValidationEvidence(input: RoleCarrierValidationEvidenceInput): Promise<{ current: boolean; issue?: "ROLE_CARRIER_MATERIAL_DRIFT" | "ROLE_CARRIER_MATERIAL_UNVERIFIED" }> {
	const unverified = { current: false, issue: "ROLE_CARRIER_MATERIAL_UNVERIFIED" } as const;
	if (!input.expectedMaterial) return unverified;
	try {
		const value: unknown = JSON.parse(await readFile(roleCarrierValidationEvidencePath(input.workspaceRoot, input.agentPackageRef), "utf8"));
		if (typeof value !== "object" || value === null || Array.isArray(value)) return unverified;
		const raw = value as Record<string, unknown>;
		if (raw.contract !== "proflow.role-carrier-validation.v2" || raw.agentPackageRef !== input.agentPackageRef || raw.registeredPackageVersion !== input.registeredPackageVersion || raw.roleRef !== input.roleRef || raw.carrierUrl !== input.carrierUrl || raw.gatewayUrl !== input.gatewayUrl) return unverified;
		const expected = roleCarrierMaterialFingerprint(input.expectedMaterial);
		if (typeof raw.materialFingerprint !== "string" || !/^sha256:[a-f0-9]{64}$/.test(raw.materialFingerprint)) return unverified;
		if (raw.materialFingerprint !== expected) return { current: false, issue: "ROLE_CARRIER_MATERIAL_DRIFT" };
		if (typeof raw.observedAt !== "string" || !Number.isFinite(Date.parse(raw.observedAt))) return unverified;
		return { current: true };
	} catch { return unverified; }
}

export async function hasCurrentRoleCarrierValidationEvidence(input: RoleCarrierValidationEvidenceInput) {
	return (await inspectRoleCarrierValidationEvidence(input)).current;
}

export async function recordRoleCarrierValidationEvidence(
	input: RoleCarrierValidationEvidenceInput,
) {
	if (!input.expectedMaterial || input.expectedMaterial.packageName !== input.agentPackageRef || input.expectedMaterial.version !== input.registeredPackageVersion) throw new Error("ROLE_CARRIER_MATERIAL_UNVERIFIED");
	const comparison = compareRoleCarrierMaterial({ expected: input.expectedMaterial, roleRef: input.roleRef, carrierUrl: input.carrierUrl, observation: input.materialObservation });
	if (comparison.status !== "MATCH") throw new Error(comparison.issue);
	const path = roleCarrierValidationEvidencePath(
		input.workspaceRoot,
		input.agentPackageRef,
	);
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = `${path}.${process.pid}.tmp`;
	await writeFile(
		temporary,
		`${JSON.stringify(
			{
				contract: "proflow.role-carrier-validation.v2",
				materialFingerprint: comparison.fingerprint,
				observedAt: comparison.observedAt,
				agentPackageRef: input.agentPackageRef,
				registeredPackageVersion: input.registeredPackageVersion,
				roleRef: input.roleRef,
				carrierUrl: input.carrierUrl,
				gatewayUrl: input.gatewayUrl,
				validatedAt: new Date().toISOString(),
			},
			null,
			2,
		)}\n`,
		{ encoding: "utf8", mode: 0o600 },
	);
	await rename(temporary, path);
}

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

export async function validateRoleCarrier(
	input: RoleCarrierValidationInput,
	dependencies?: {
		fetch?: typeof globalThis.fetch;
		retryDelayMs?: number;
		readLiveMaterial?: () => Promise<unknown>;
	},
) {
	const issues = validateLocalRoleOpenApi(input.openApiText);
	let materialObservation: unknown;
	try { materialObservation = await dependencies?.readLiveMaterial?.(); } catch { /* unavailable is not proof of drift or readiness */ }
	const comparison = input.expectedMaterial && input.roleRef && input.carrierUrl
		? compareRoleCarrierMaterial({ expected: input.expectedMaterial, roleRef: input.roleRef, carrierUrl: input.carrierUrl, observation: materialObservation })
		: { status: "FAIL" as const, issue: "ROLE_CARRIER_MATERIAL_UNVERIFIED" as const };
	if (comparison.status !== "MATCH") issues.push(comparison.issue);
	const gatewayUrl = parseGatewayUrl(input.gatewayUrl);
	const fetchImplementation = dependencies?.fetch ?? globalThis.fetch;
	try {
		const health = await fetchImplementation(`${gatewayUrl}/health`, {
			signal: AbortSignal.timeout(5_000),
		});
		if (!health.ok) issues.push(`GATEWAY_HEALTH_HTTP_${health.status}`);
	} catch {
		issues.push("GATEWAY_HEALTH_UNREACHABLE");
	}
	// getTask is a read-only Action present on all three v1 Role packages. An
	// intentionally missing Task gives the downstream a harmless validation
	// failure while proving that Gateway ingress accepted the role-scoped key.
	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			const probe = await fetchImplementation(
				`${gatewayUrl}/actions/getTask?taskId=__proflow_role_validate_probe__`,
				{
					headers: { authorization: `Bearer ${input.credential}` },
					signal: AbortSignal.timeout(5_000),
				},
			);
			if (probe.status === 401) issues.push("GATEWAY_ROLE_KEY_REJECTED");
			else if (probe.status === 403) issues.push("GATEWAY_ROLE_OPERATION_DENIED");
			else if (probe.status === 404 || probe.status >= 500)
				issues.push(`GATEWAY_ACTION_PROBE_HTTP_${probe.status}`);
			break;
		} catch {
			if (attempt === 1) {
				issues.push("GATEWAY_ACTION_PROBE_UNREACHABLE");
				break;
			}
			await new Promise((resolve) =>
				setTimeout(resolve, dependencies?.retryDelayMs ?? 250),
			);
		}
	}
	return {
		status: issues.length === 0 ? ("PASS" as const) : ("FAIL" as const),
		issues,
		materialObservation,
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
		adoptCurrentRoleVersion: (input: unknown) =>
			runtime.adoptCurrentRoleVersion(input),
		prepareRoleCredential: () => runtime.prepareRoleCredential(),
		saveCurrentRole: (input: unknown, preparedCredential?: string) =>
			runtime.saveCurrentRole(input, preparedCredential),
		deleteRole: (roleRef: string) => runtime.deleteRole(roleRef),
		inspectRole(input: {
			agentPackageRef: string;
			expectedPackageVersion: string;
		}) {
			return inspectDurableRoleRegistration({ proflowRoot, ...input });
		},
		showRoleCredentialByRef: (roleRef: string) => runtime.showCredential(roleRef),
		async showRoleCredential(input: {
			agentPackageRef: string;
			expectedPackageVersion: string;
		}) {
			const inspected = inspectDurableRoleRegistration({
				proflowRoot,
				...input,
			});
			if (inspected.status !== "READY" || !inspected.role)
				throw new Error("ROLE_NOT_READY");
			return runtime.showCredential(inspected.role.roleRef);
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

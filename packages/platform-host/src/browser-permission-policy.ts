import { type RolePackageRef, roleOperations } from "./role-operations.ts";

export type BrowserPermissionRole = {
	agentPackageRef: RolePackageRef;
	registeredPackageVersion: string;
	roleRef: string;
	carrierUrl: string;
};

export type RoleCarrierValidation = {
	agentPackageRef: string;
	registeredPackageVersion: string;
	roleRef: string;
	carrierUrl: string;
	gatewayUrl: string;
};

export type BrowserPermissionDecision = {
	decision: "AUTO_ALLOW" | "HUMAN_REQUIRED";
	reason:
		| "KNOWN_PROFLOW_ACTION"
		| "ROLE_VALIDATION_MISMATCH"
		| "GATEWAY_MISMATCH"
		| "OPERATION_NOT_AUTHORIZED"
		| "CONTEXT_MISMATCH";
};

export type BrowserPermissionContext = {
	conversationLocator: string;
	workerRef: string | null;
	taskBinding: {
		agentPackageRef: string;
		roleRef: string;
		workerRef: string | null;
		conversationLocator: string | null;
	} | null;
};

const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function contextMatches(
	role: BrowserPermissionRole,
	context: BrowserPermissionContext,
): boolean {
	const workerRef = context.workerRef;
	const binding = context.taskBinding;
	if (!workerRef || !binding?.workerRef || !binding.conversationLocator)
		return false;
	if (
		binding.agentPackageRef !== role.agentPackageRef ||
		binding.roleRef !== role.roleRef ||
		binding.workerRef !== workerRef ||
		binding.conversationLocator !== context.conversationLocator
	)
		return false;
	try {
		const locator = new URL(context.conversationLocator);
		const segments = locator.pathname.split("/").filter(Boolean);
		return (
			locator.protocol === "https:" &&
			locator.hostname === "chatgpt.com" &&
			locator.username === "" &&
			locator.password === "" &&
			locator.search === "" &&
			locator.hash === "" &&
			segments.length === 4 &&
			segments[0] === "g" &&
			segments[1] === role.roleRef &&
			segments[2] === "c" &&
			segments[3] === workerRef
		);
	} catch {
		return false;
	}
}

export function classifyBrowserPermission(input: {
	role: BrowserPermissionRole;
	validation: RoleCarrierValidation | null;
	targetHost: string | null;
	currentGatewayUrl: string | null;
	operationId: string;
	context: BrowserPermissionContext;
}): BrowserPermissionDecision {
	const validation = input.validation;
	if (
		validation === null ||
		validation.agentPackageRef !== input.role.agentPackageRef ||
		validation.registeredPackageVersion !==
			input.role.registeredPackageVersion ||
		validation.roleRef !== input.role.roleRef ||
		validation.carrierUrl !== input.role.carrierUrl
	)
		return { decision: "HUMAN_REQUIRED", reason: "ROLE_VALIDATION_MISMATCH" };

	let trustedHost: string;
	try {
		const gateway = new URL(validation.gatewayUrl);
		const currentGateway = new URL(input.currentGatewayUrl ?? "");
		const trustedTransport =
			gateway.protocol === "https:" ||
			(gateway.protocol === "http:" && loopbackHosts.has(gateway.hostname));
		if (
			!trustedTransport ||
			currentGateway.origin !== gateway.origin ||
			gateway.pathname !== "/" ||
			gateway.search !== "" ||
			gateway.hash !== "" ||
			gateway.username !== "" ||
			gateway.password !== "" ||
			currentGateway.pathname !== "/" ||
			currentGateway.search !== "" ||
			currentGateway.hash !== "" ||
			currentGateway.username !== "" ||
			currentGateway.password !== ""
		)
			return { decision: "HUMAN_REQUIRED", reason: "GATEWAY_MISMATCH" };
		trustedHost = gateway.hostname.toLowerCase();
	} catch {
		return { decision: "HUMAN_REQUIRED", reason: "GATEWAY_MISMATCH" };
	}
	if (input.targetHost?.toLowerCase() !== trustedHost)
		return { decision: "HUMAN_REQUIRED", reason: "GATEWAY_MISMATCH" };

	if (!roleOperations[input.role.agentPackageRef].has(input.operationId))
		return {
			decision: "HUMAN_REQUIRED",
			reason: "OPERATION_NOT_AUTHORIZED",
		};
	if (!contextMatches(input.role, input.context))
		return { decision: "HUMAN_REQUIRED", reason: "CONTEXT_MISMATCH" };
	return { decision: "AUTO_ALLOW", reason: "KNOWN_PROFLOW_ACTION" };
}

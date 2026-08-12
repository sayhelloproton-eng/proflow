import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
	type LifecyclePrimitive,
	type ModuleDescriptor,
	moduleDescriptorSchema,
	moduleOperationResultSchema,
} from "@tomflow/proflow-module-contract";

export type GateStatus = "PASS" | "FAIL";

export interface ConformanceIssue {
	code: string;
	message: string;
}

export interface ConformanceGateResult {
	gate: "C1" | "C2" | "C3" | "GPT_ACTIONS_FILE_BRIDGE";
	status: GateStatus;
	issues: ConformanceIssue[];
}

function gate(
	name: ConformanceGateResult["gate"],
	issues: ConformanceIssue[],
): ConformanceGateResult {
	return { gate: name, status: issues.length === 0 ? "PASS" : "FAIL", issues };
}

export function runStaticConformance(input: unknown): ConformanceGateResult {
	const parsed = moduleDescriptorSchema.safeParse(input);
	if (parsed.success) return gate("C1", []);
	return gate(
		"C1",
		parsed.error.issues.map((issue) => ({
			code: "CONTRACT_INVALID",
			message: `${issue.path.join(".") || "descriptor"}: ${issue.message}`,
		})),
	);
}

interface PackageMetadata {
	name?: unknown;
	version?: unknown;
	type?: unknown;
	exports?: unknown;
	bin?: unknown;
}

function containsPlaintextSecret(input: unknown, key = ""): boolean {
	if (typeof input === "string") {
		return /(secret|token|password)/i.test(key) && input.length > 0;
	}
	if (Array.isArray(input))
		return input.some((item) => containsPlaintextSecret(item, key));
	if (typeof input !== "object" || input === null) return false;
	return Object.entries(input).some(([nestedKey, value]) =>
		containsPlaintextSecret(value, nestedKey),
	);
}

async function pathExists(path: string): Promise<boolean> {
	try {
		const value = await stat(path);
		return value.isFile();
	} catch {
		return false;
	}
}

function exportedEntry(metadata: PackageMetadata): string | undefined {
	if (typeof metadata.exports !== "object" || metadata.exports === null)
		return undefined;
	const root = Reflect.get(metadata.exports, ".");
	return typeof root === "string" ? root : undefined;
}

export async function runPackageConformance(
	packageDirectory: string,
	descriptor: ModuleDescriptor,
): Promise<ConformanceGateResult> {
	const issues: ConformanceIssue[] = [];
	let metadata: PackageMetadata;
	try {
		metadata = JSON.parse(
			await readFile(join(packageDirectory, "package.json"), "utf8"),
		) as PackageMetadata;
	} catch {
		return gate("C2", [
			{
				code: "PACKAGE_JSON_INVALID",
				message: "package.json is missing or invalid",
			},
		]);
	}
	if (metadata.name !== descriptor.packageName) {
		issues.push({
			code: "PACKAGE_NAME_MISMATCH",
			message: "package name differs from descriptor",
		});
	}
	if (metadata.version !== descriptor.moduleVersion) {
		issues.push({
			code: "PACKAGE_VERSION_MISMATCH",
			message: "package version differs from descriptor",
		});
	}
	if (metadata.type !== "module") {
		issues.push({
			code: "PACKAGE_NOT_ESM",
			message: "package type must be module",
		});
	}
	if (containsPlaintextSecret(metadata)) {
		issues.push({
			code: "PACKAGE_SECRET_LEAK",
			message: "package metadata contains a plaintext secret",
		});
	}
	const entry = exportedEntry(metadata);
	if (
		entry === undefined ||
		!(await pathExists(resolve(packageDirectory, entry)))
	) {
		issues.push({
			code: "PACKAGE_ENTRY_INVALID",
			message: "root export must reference a real file",
		});
	}
	if (!(await pathExists(join(packageDirectory, "deployment/descriptor.ts")))) {
		issues.push({
			code: "DESCRIPTOR_ENTRY_MISSING",
			message: "deployment descriptor entry is missing",
		});
	}
	if (!(await pathExists(join(packageDirectory, "conformance.json")))) {
		issues.push({
			code: "CONFORMANCE_CONFIG_MISSING",
			message: "conformance config is missing",
		});
	}
	if (
		descriptor.kind === "cli" &&
		!(await pathExists(join(packageDirectory, "src/cli.ts")))
	) {
		issues.push({
			code: "MACHINE_ENTRY_MISSING",
			message: "CLI machine entry is missing",
		});
	}
	if (
		descriptor.kind === "external-resource" &&
		!(await pathExists(join(packageDirectory, "src/resource-adapter.ts")))
	) {
		issues.push({
			code: "ADAPTER_ENTRY_MISSING",
			message: "external resource adapter is missing",
		});
	}
	return gate("C2", issues);
}

export interface BehaviorObservation {
	result: unknown;
	observedEffects: string[];
	externalAvailabilityClaim?: "UNKNOWN" | "AVAILABLE" | "UNAVAILABLE";
	externalAvailabilityEvidence?: "none" | "fake" | "real";
	readinessClaim?: "UNKNOWN" | "READY" | "NOT_READY";
	readinessEvidence?: "none" | "fake" | "real";
}

type BehaviorOperation = () =>
	| BehaviorObservation
	| Promise<BehaviorObservation>;
export type BehaviorAdapter = Partial<
	Record<LifecyclePrimitive, BehaviorOperation>
>;

export async function runBehaviorConformance(
	descriptor: ModuleDescriptor,
	adapter: BehaviorAdapter,
): Promise<ConformanceGateResult> {
	const issues: ConformanceIssue[] = [];
	for (const primitive of descriptor.lifecycle.supported) {
		const operation = adapter[primitive];
		if (operation === undefined) {
			issues.push({
				code: "DECLARED_BEHAVIOR_MISSING",
				message: `${primitive} is declared but unavailable`,
			});
			continue;
		}
		let observation: BehaviorObservation;
		try {
			observation = await operation();
		} catch {
			issues.push({
				code: "BEHAVIOR_THREW",
				message: `${primitive} threw instead of returning a structured result`,
			});
			continue;
		}
		const parsedResult = moduleOperationResultSchema.safeParse(
			observation.result,
		);
		if (!parsedResult.success) {
			issues.push({
				code: "RESULT_INVALID",
				message: `${primitive} returned an invalid result contract`,
			});
		}
		if (
			primitive === "verify" &&
			parsedResult.success &&
			!parsedResult.data.checks?.some(
				(check) => check.status === "PASS" || check.status === "FAIL",
			)
		) {
			issues.push({
				code: "VERIFY_NOT_OBSERVED",
				message: "verify must contain an observed PASS or FAIL check",
			});
		}
		if (
			primitive === "status" &&
			observation.readinessClaim === "READY" &&
			observation.readinessEvidence !== "real"
		) {
			issues.push({
				code: "FAKE_READY",
				message: "READY requires real current evidence",
			});
		}
		if (
			["preflight", "doctor"].includes(primitive) &&
			observation.observedEffects.length > 0
		) {
			issues.push({
				code: "UNDECLARED_EFFECT",
				message: `${primitive} produced effects by default`,
			});
		}
		if (
			descriptor.kind === "external-resource" &&
			primitive === "status" &&
			observation.externalAvailabilityClaim === "AVAILABLE" &&
			observation.externalAvailabilityEvidence !== "real"
		) {
			issues.push({
				code: "FAKE_EXTERNAL_AVAILABILITY",
				message: "fake evidence cannot establish real external availability",
			});
		}
	}
	return gate("C3", issues);
}

export interface GptActionOperation {
	operationId: string;
	role: string;
	consequential?: boolean;
	customHeaders: string[];
	summary: string;
	description: string;
	parameters: Array<{ name: string; description: string }>;
	acceptsOpenAiFileIdRefs: boolean;
	responseSupportsOpenAiFileResponse: boolean;
}

export type FileBridgeError =
	| "OPENAI_FILE_INVALID"
	| "OPENAI_FILE_COUNT_EXCEEDED"
	| "OPENAI_FILE_SIZE_EXCEEDED"
	| "OPENAI_FILE_AGGREGATE_SIZE_EXCEEDED"
	| "OPENAI_FILE_LOCATOR_EXPIRED"
	| "OPENAI_FILE_FETCH_TIMEOUT"
	| "OPENAI_FILE_FETCH_FAILED"
	| "OPENAI_FILE_MIME_MISMATCH"
	| "OPENAI_FILE_UNSUPPORTED_MEDIA"
	| "OPENAI_ACTION_REQUEST_BUDGET_EXCEEDED"
	| "OPENAI_ACTION_RESPONSE_BUDGET_EXCEEDED"
	| "OPENAI_RELAY_EXPIRED"
	| "OPENAI_RELAY_SCOPE_INVALID";

export interface GptActionsConformanceInput {
	usesActions: boolean;
	usesAppsAsP0: boolean;
	operations: GptActionOperation[];
	fileBridge: {
		maxInputFiles: number;
		maxInputFileBytes: number;
		maxAggregateInputBytes: number;
		inputFetchTimeoutMs: number;
		relayTtlMs: number;
		maxBlockingMs: number;
		requestSerializedCharacters: number;
		responseSerializedCharacters: number;
		inlineResponseSerializedCharacters: number;
		responseMode: "inline" | "relay";
		inputFiles: Array<{
			size: number;
			url: string;
			redirectUrls: string[];
			filename: string;
			declaredMime: string;
			detectedMime: string;
		}>;
		openAiFileIdRefs: Array<{ name: string; id: string }>;
		responseFiles: Array<{ size: number; mimeType: string }>;
		downloadLinkPersisted: boolean;
		preservesHttpErrorStatus: boolean;
		blindReplayAfterEffect: boolean;
		relay: {
			methods: string[];
			opaqueToken: boolean;
			scope: "artifact" | "outputRef" | "global";
			ttlMs: number;
			contentType: string;
			contentDisposition: string;
		};
		typedErrors: FileBridgeError[];
	};
}

const requiredFileBridgeErrors: FileBridgeError[] = [
	"OPENAI_FILE_INVALID",
	"OPENAI_FILE_COUNT_EXCEEDED",
	"OPENAI_FILE_SIZE_EXCEEDED",
	"OPENAI_FILE_AGGREGATE_SIZE_EXCEEDED",
	"OPENAI_FILE_LOCATOR_EXPIRED",
	"OPENAI_FILE_FETCH_TIMEOUT",
	"OPENAI_FILE_FETCH_FAILED",
	"OPENAI_FILE_MIME_MISMATCH",
	"OPENAI_FILE_UNSUPPORTED_MEDIA",
	"OPENAI_ACTION_REQUEST_BUDGET_EXCEEDED",
	"OPENAI_ACTION_RESPONSE_BUDGET_EXCEEDED",
	"OPENAI_RELAY_EXPIRED",
	"OPENAI_RELAY_SCOPE_INVALID",
];

function isSafeCarrierUrl(value: string): boolean {
	try {
		const url = new URL(value);
		if (url.protocol !== "https:" || (url.port !== "" && url.port !== "443"))
			return false;
		const host = url.hostname.toLowerCase();
		const normalizedHost = host.replace(/^\[/, "").replace(/\]$/, "");
		if (
			normalizedHost === "localhost" ||
			normalizedHost === "metadata.google.internal" ||
			normalizedHost === "169.254.169.254" ||
			normalizedHost === "::1" ||
			/^f[cd][0-9a-f]{2}:/i.test(normalizedHost) ||
			/^fe[89ab][0-9a-f]:/i.test(normalizedHost)
		)
			return false;
		if (/^(127\.|10\.|192\.168\.|169\.254\.)/.test(host)) return false;
		const match = /^(172)\.(\d+)\./.exec(host);
		if (
			match?.[2] !== undefined &&
			Number(match[2]) >= 16 &&
			Number(match[2]) <= 31
		)
			return false;
		return true;
	} catch {
		return false;
	}
}

function add(
	issues: ConformanceIssue[],
	condition: boolean,
	code: string,
	message: string,
): void {
	if (!condition) issues.push({ code, message });
}

function isSafeFilename(filename: string): boolean {
	return (
		!filename.includes("/") &&
		!filename.includes("\\") &&
		[...filename].every((character) => (character.codePointAt(0) ?? 0) >= 32)
	);
}

function isGptActionsInput(
	input: unknown,
): input is GptActionsConformanceInput {
	if (typeof input !== "object" || input === null) return false;
	const operations = Reflect.get(input, "operations");
	const bridge = Reflect.get(input, "fileBridge");
	return (
		Array.isArray(operations) && typeof bridge === "object" && bridge !== null
	);
}

function evaluateGptActionsConformance(
	input: GptActionsConformanceInput,
): ConformanceGateResult {
	const issues: ConformanceIssue[] = [];
	add(
		issues,
		!(input.usesActions && input.usesAppsAsP0),
		"ACTIONS_APPS_P0_CONFLICT",
		"Actions and Apps cannot both be P0",
	);
	const operationKeys = new Set<string>();
	for (const operation of input.operations) {
		add(
			issues,
			typeof operation.consequential === "boolean",
			"CONSEQUENTIAL_MISSING",
			"every operation must declare consequential",
		);
		add(
			issues,
			operation.customHeaders.length === 0,
			"CUSTOM_HEADERS_UNSUPPORTED",
			"custom request headers are unsupported",
		);
		const key = `${operation.role}:${operation.operationId}`;
		add(
			issues,
			!operationKeys.has(key),
			"OPERATION_ID_DUPLICATE",
			"operationId must be unique and role-scoped",
		);
		operationKeys.add(key);
		add(
			issues,
			operation.operationId.startsWith(`${operation.role}_`),
			"OPERATION_ID_SCOPE_INVALID",
			"operationId must be role-scoped",
		);
		add(
			issues,
			operation.summary.length > 0 && operation.summary.length <= 300,
			"SUMMARY_INVALID",
			"summary length is invalid",
		);
		add(
			issues,
			operation.description.length > 0 && operation.description.length <= 700,
			"DESCRIPTION_INVALID",
			"description length is invalid",
		);
		for (const parameter of operation.parameters) {
			add(
				issues,
				parameter.description.length > 0 && parameter.description.length <= 700,
				"PARAMETER_DESCRIPTION_INVALID",
				`parameter ${parameter.name} description is invalid`,
			);
		}
		if (operation.acceptsOpenAiFileIdRefs) {
			add(
				issues,
				operation.responseSupportsOpenAiFileResponse,
				"FILE_RESPONSE_SCHEMA_MISSING",
				"file ingress operation must support normalized file response",
			);
		}
	}
	const bridge = input.fileBridge;
	add(
		issues,
		Array.isArray(bridge.openAiFileIdRefs) &&
			bridge.openAiFileIdRefs.every(
				(reference) =>
					typeof reference === "object" &&
					reference !== null &&
					typeof reference.name === "string" &&
					reference.name.length > 0 &&
					typeof reference.id === "string" &&
					reference.id.length > 0,
			),
		"OPENAI_FILE_ID_REFS_INVALID",
		"openaiFileIdRefs must contain named file identifiers",
	);
	add(
		issues,
		bridge.maxInputFiles === 10,
		"FILE_COUNT_LIMIT_INVALID",
		"maxInputFiles must equal 10",
	);
	add(
		issues,
		bridge.maxInputFileBytes === 10_000_000,
		"FILE_SIZE_LIMIT_INVALID",
		"maxInputFileBytes must equal 10MB",
	);
	add(
		issues,
		bridge.maxAggregateInputBytes === 50_000_000,
		"FILE_AGGREGATE_LIMIT_INVALID",
		"maxAggregateInputBytes must equal 50MB",
	);
	add(
		issues,
		bridge.inputFetchTimeoutMs === 15_000,
		"FETCH_TIMEOUT_INVALID",
		"fetch timeout must equal 15s",
	);
	add(
		issues,
		bridge.relayTtlMs === 300_000,
		"RELAY_TTL_INVALID",
		"relay TTL must equal 5 minutes",
	);
	add(
		issues,
		bridge.maxBlockingMs <= 45_000,
		"BLOCKING_LIMIT_EXCEEDED",
		"operation cannot depend on more than 45s blocking",
	);
	add(
		issues,
		bridge.requestSerializedCharacters < 100_000,
		"REQUEST_BUDGET_EXCEEDED",
		"request serialization must remain below 100k",
	);
	add(
		issues,
		bridge.responseSerializedCharacters < 100_000,
		"RESPONSE_BUDGET_EXCEEDED",
		"response serialization must remain below 100k",
	);
	if (bridge.inlineResponseSerializedCharacters >= 100_000) {
		add(
			issues,
			bridge.responseMode === "relay",
			"INLINE_RESPONSE_NOT_RELAYED",
			"oversized inline response must switch to relay",
		);
	}
	add(
		issues,
		bridge.inputFiles.length <= 10,
		"INPUT_FILE_COUNT_EXCEEDED",
		"input file count exceeds 10",
	);
	add(
		issues,
		bridge.responseFiles.length <= 10,
		"RESPONSE_FILE_COUNT_EXCEEDED",
		"response file count exceeds 10",
	);
	let aggregate = 0;
	for (const file of bridge.inputFiles) {
		aggregate += file.size;
		add(
			issues,
			file.size <= 10_000_000,
			"INPUT_FILE_SIZE_EXCEEDED",
			"input file exceeds 10MB",
		);
		add(
			issues,
			isSafeCarrierUrl(file.url),
			"SSRF_TARGET_REJECTED",
			"input URL is not a safe public TLS target",
		);
		add(
			issues,
			file.redirectUrls.every(isSafeCarrierUrl),
			"SSRF_REDIRECT_REJECTED",
			"redirect chain contains an unsafe target",
		);
		add(
			issues,
			isSafeFilename(file.filename),
			"FILENAME_INVALID",
			"filename contains path or control characters",
		);
		add(
			issues,
			file.declaredMime === file.detectedMime,
			"MIME_MISMATCH",
			"declared and detected MIME differ",
		);
	}
	add(
		issues,
		aggregate <= 50_000_000,
		"INPUT_AGGREGATE_EXCEEDED",
		"input aggregate exceeds 50MB",
	);
	for (const file of bridge.responseFiles) {
		add(
			issues,
			file.size <= 10_000_000,
			"RESPONSE_FILE_SIZE_EXCEEDED",
			"response file exceeds 10MB",
		);
		add(
			issues,
			!/^(image|video)\//.test(file.mimeType),
			"RESPONSE_MEDIA_UNSUPPORTED",
			"image/video response files are unsupported",
		);
	}
	add(
		issues,
		!bridge.downloadLinkPersisted,
		"DOWNLOAD_LINK_PERSISTED",
		"transient download links cannot be persisted",
	);
	add(
		issues,
		bridge.preservesHttpErrorStatus,
		"HTTP_STATUS_MASKED",
		"real 429/5xx semantics must be preserved",
	);
	add(
		issues,
		!bridge.blindReplayAfterEffect,
		"BLIND_REPLAY_UNSAFE",
		"effects cannot be blindly replayed",
	);
	add(
		issues,
		bridge.relay.methods.length === 1 && bridge.relay.methods[0] === "GET",
		"RELAY_METHOD_INVALID",
		"relay must be GET-only",
	);
	add(
		issues,
		bridge.relay.opaqueToken,
		"RELAY_TOKEN_NOT_OPAQUE",
		"relay token must be opaque",
	);
	add(
		issues,
		["artifact", "outputRef"].includes(bridge.relay.scope),
		"RELAY_SCOPE_INVALID",
		"relay scope must bind artifact or outputRef",
	);
	add(
		issues,
		bridge.relay.ttlMs > 0 && bridge.relay.ttlMs <= 300_000,
		"RELAY_TOKEN_TTL_INVALID",
		"relay token TTL must be bounded by 5 minutes",
	);
	add(
		issues,
		bridge.relay.contentType.length > 0,
		"RELAY_CONTENT_TYPE_MISSING",
		"relay must emit Content-Type",
	);
	add(
		issues,
		bridge.relay.contentDisposition.length > 0,
		"RELAY_CONTENT_DISPOSITION_MISSING",
		"relay must emit Content-Disposition",
	);
	add(
		issues,
		!/[\\/]/.test(bridge.relay.contentDisposition) &&
			!/secret/i.test(bridge.relay.contentDisposition),
		"RELAY_HEADER_LEAK",
		"relay headers cannot leak local paths or secrets",
	);
	for (const error of requiredFileBridgeErrors) {
		add(
			issues,
			bridge.typedErrors.includes(error),
			"TYPED_ERROR_MISSING",
			`missing typed error ${error}`,
		);
	}
	return gate("GPT_ACTIONS_FILE_BRIDGE", issues);
}

export function runGptActionsConformance(
	input: unknown,
): ConformanceGateResult {
	if (!isGptActionsInput(input)) {
		return gate("GPT_ACTIONS_FILE_BRIDGE", [
			{
				code: "GPT_ACTIONS_INPUT_INVALID",
				message: "GPT Actions conformance input is invalid",
			},
		]);
	}
	try {
		return evaluateGptActionsConformance(input);
	} catch {
		return gate("GPT_ACTIONS_FILE_BRIDGE", [
			{
				code: "GPT_ACTIONS_INPUT_INVALID",
				message: "GPT Actions conformance input has an invalid nested shape",
			},
		]);
	}
}

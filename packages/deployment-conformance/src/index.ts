import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
	type LifecyclePrimitive,
	type ModuleDescriptor,
	moduleDescriptorSchema,
	moduleOperationResultSchema,
	proflowPackageMetadataSchema,
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

function isPackageRelativePath(value: string): boolean {
	return (
		value.startsWith("./") &&
		!isAbsolute(value) &&
		!value.split(/[\\/]/).includes("..") &&
		!value.includes("://")
	);
}

export function runStaticConformance(input: unknown): ConformanceGateResult {
	const parsed = moduleDescriptorSchema.safeParse(input);
	if (!parsed.success) {
		return gate(
			"C1",
			parsed.error.issues.map((issue) => ({
				code: "CONTRACT_INVALID",
				message: `${issue.path.join(".") || "descriptor"}: ${issue.message}`,
			})),
		);
	}
	const descriptor = parsed.data;
	const issues: ConformanceIssue[] = [];
	const rangePattern =
		/^(?:(?:>=|>|<=|<|=)?\d+\.\d+\.\d+)(?:\s+(?:(?:>=|>|<=|<|=)?\d+\.\d+\.\d+))*$/;
	if (!rangePattern.test(descriptor.platformCompatibility)) {
		issues.push({
			code: "PLATFORM_COMPATIBILITY_INVALID",
			message: "platformCompatibility must be a machine-readable SemVer range",
		});
	}
	const provided = new Set<string>();
	for (const item of descriptor.provides) {
		if (provided.has(item.contractRef)) {
			issues.push({
				code: "PROVIDE_DUPLICATE",
				message: `duplicate provide ${item.contractRef}`,
			});
		}
		provided.add(item.contractRef);
	}
	const required = new Set<string>();
	for (const item of descriptor.requires) {
		if (!rangePattern.test(item.versionRange)) {
			issues.push({
				code: "REQUIRE_VERSION_INVALID",
				message: `invalid require range ${item.contractRef}`,
			});
		}
		if (required.has(item.contractRef)) {
			issues.push({
				code: "REQUIRE_DUPLICATE",
				message: `duplicate require ${item.contractRef}`,
			});
		}
		if (provided.has(item.contractRef)) {
			issues.push({
				code: "PROVIDE_REQUIRE_CONFLICT",
				message: `${item.contractRef} is both provided and required`,
			});
		}
		required.add(item.contractRef);
	}
	const lifecycle = new Set(descriptor.lifecycle.supported);
	if (
		descriptor.kind === "service" &&
		!["status", "start", "stop", "restart", "verify"].every((item) =>
			lifecycle.has(item as LifecyclePrimitive),
		)
	) {
		issues.push({
			code: "SERVICE_LIFECYCLE_INCOMPLETE",
			message: "service requires status/start/stop/restart/verify",
		});
	}
	if (
		descriptor.kind === "service" &&
		!descriptor.effects.some((effect) => effect.kind === "process")
	) {
		issues.push({
			code: "SERVICE_PROCESS_EFFECT_MISSING",
			message: "service must declare its process effect",
		});
	}
	if (
		["browser-extension", "agent-package", "external-resource"].includes(
			descriptor.kind,
		) &&
		!["status", "verify"].every((item) =>
			lifecycle.has(item as LifecyclePrimitive),
		)
	) {
		issues.push({
			code: "PROFILE_OBSERVABILITY_INCOMPLETE",
			message: `${descriptor.kind} requires status and verify`,
		});
	}
	if (
		descriptor.kind === "library" &&
		descriptor.effects.some((effect) => effect.kind === "process")
	) {
		issues.push({
			code: "LIBRARY_PROCESS_EFFECT_INVALID",
			message: "library cannot be a daemon process",
		});
	}
	if (
		new Set(descriptor.verification.checks.map((check) => check.id)).size !==
		descriptor.verification.checks.length
	) {
		issues.push({
			code: "VERIFICATION_DUPLICATE",
			message: "verification check ids must be unique",
		});
	}
	if (
		new Set(descriptor.documentation.map((entry) => entry.id)).size !==
		descriptor.documentation.length
	) {
		issues.push({
			code: "DOCUMENTATION_DUPLICATE",
			message: "documentation entry ids must be unique",
		});
	}
	for (const entry of descriptor.documentation) {
		if (!isPackageRelativePath(entry.path)) {
			issues.push({
				code: "DOCUMENTATION_PATH_INVALID",
				message: `documentation ${entry.id} must use a package-relative path`,
			});
		}
	}
	if (
		descriptor.effects.some((effect) => effect.retention === "remove") &&
		!lifecycle.has("uninstall")
	) {
		issues.push({
			code: "UNINSTALL_LIFECYCLE_REQUIRED",
			message: "effects with remove retention require package-owned uninstall lifecycle",
		});
	}
	return gate("C1", issues);
}

interface PackageMetadata {
	name?: unknown;
	version?: unknown;
	type?: unknown;
	exports?: unknown;
	bin?: unknown;
	private?: unknown;
	publishConfig?: unknown;
	files?: unknown;
	proflow?: unknown;
	dependencies?: unknown;
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

async function readJson(path: string): Promise<unknown> {
	return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function compilerOptionsFor(
	tsconfigPath: string,
): Promise<Record<string, unknown>> {
	const input = await readJson(tsconfigPath);
	if (typeof input !== "object" || input === null) return {};
	const own = Reflect.get(input, "compilerOptions");
	const ownOptions =
		typeof own === "object" && own !== null
			? (own as Record<string, unknown>)
			: {};
	const extended = Reflect.get(input, "extends");
	if (typeof extended !== "string") return ownOptions;
	const inherited = await compilerOptionsFor(
		resolve(dirname(tsconfigPath), extended),
	);
	return { ...inherited, ...ownOptions };
}

async function sourceFiles(directory: string): Promise<string[]> {
	const collected: string[] = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) collected.push(...(await sourceFiles(path)));
		else if (entry.isFile()) collected.push(path);
	}
	return collected;
}

function exportEntry(
	metadata: PackageMetadata,
	key: string,
): string | undefined {
	if (typeof metadata.exports !== "object" || metadata.exports === null)
		return undefined;
	const value = Reflect.get(metadata.exports, key);
	return typeof value === "string" ? value : undefined;
}

function exportedEntry(metadata: PackageMetadata): string | undefined {
	return exportEntry(metadata, ".");
}

function packageExecutableName(packageName: string): string {
	return packageName.includes("/") ? packageName.split("/").at(-1)! : packageName;
}

function packageBinEntry(
	metadata: PackageMetadata,
	packageName: string,
): string | undefined {
	if (typeof metadata.bin === "string") return metadata.bin;
	if (typeof metadata.bin !== "object" || metadata.bin === null) return undefined;
	const value = Reflect.get(metadata.bin, packageExecutableName(packageName));
	return typeof value === "string" ? value : undefined;
}

function stringArrayIncludes(input: unknown, value: string): boolean {
	return Array.isArray(input) && input.some((item) => item === value || item === `./${value}`);
}

function canonicalValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalValue);
	if (typeof value !== "object" || value === null) return value;
	const record = value as Record<string, unknown>;
	return Object.fromEntries(
		Object.keys(record)
			.sort()
			.map((key) => [key, canonicalValue(record[key])]),
	);
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
	const parsedProflow = proflowPackageMetadataSchema.safeParse(metadata.proflow);
	if (!parsedProflow.success) {
		issues.push({
			code: "PROFLOW_PACKAGE_METADATA_INVALID",
			message: "package.json.proflow must declare module/installClass/descriptor/manifest/installRequires",
		});
	} else {
		if (parsedProflow.data.installClass !== descriptor.installClass) {
			issues.push({
				code: "INSTALL_CLASS_MISMATCH",
				message: "package.json.proflow.installClass differs from descriptor",
			});
		}
		if (new Set(parsedProflow.data.installRequires).size !== parsedProflow.data.installRequires.length) {
			issues.push({
				code: "INSTALL_REQUIRES_DUPLICATE",
				message: "package.json.proflow.installRequires must not contain duplicates",
			});
		}
		if (parsedProflow.data.installRequires.includes(descriptor.packageName)) {
			issues.push({
				code: "INSTALL_REQUIRES_SELF",
				message: "package.json.proflow.installRequires must not contain the package itself",
			});
		}
		if (typeof metadata.dependencies === "object" && metadata.dependencies !== null) {
			for (const dependencyName of Object.keys(metadata.dependencies)) {
				if (
					dependencyName.startsWith("@tomflow/proflow-") &&
					!parsedProflow.data.installRequires.includes(dependencyName)
				) {
					issues.push({
						code: "INSTALL_REQUIRES_RUNTIME_DEPENDENCY_MISSING",
						message: `ProFlow runtime dependency ${dependencyName} must be included in package.json.proflow.installRequires`,
					});
				}
			}
		}
		const manifestPath = resolve(packageDirectory, parsedProflow.data.manifest);
		if (!(await pathExists(manifestPath))) {
			issues.push({
				code: "MODULE_MANIFEST_MISSING",
				message: "proflow.module.json is missing",
			});
		} else {
			try {
				const manifest = moduleDescriptorSchema.parse(await readJson(manifestPath));
				if (
					JSON.stringify(canonicalValue(manifest)) !==
					JSON.stringify(canonicalValue(descriptor))
				) {
					issues.push({
						code: "MODULE_MANIFEST_MISMATCH",
						message: "proflow.module.json must describe the same Module facts as deployment/descriptor",
					});
				}
			} catch {
				issues.push({
					code: "MODULE_MANIFEST_INVALID",
					message: "proflow.module.json is not a valid Module Descriptor",
				});
			}
		}
		if (!stringArrayIncludes(metadata.files, "proflow.module.json")) {
			issues.push({
				code: "MODULE_MANIFEST_NOT_PUBLISHED",
				message: "proflow.module.json must be included in the npm files allowlist",
			});
		}
	}
	if (metadata.type !== "module") {
		issues.push({
			code: "PACKAGE_NOT_ESM",
			message: "package type must be module",
		});
	}
	if (metadata.private === true) {
		issues.push({
			code: "FORMAL_MODULE_PRIVATE",
			message: "formal Module packages must be publishable",
		});
	}
	if (descriptor.moduleRef === "platform-cli") {
		const platformBin =
			typeof metadata.bin === "object" && metadata.bin !== null
				? Reflect.get(metadata.bin, "platform")
				: undefined;
		if (typeof platformBin !== "string") {
			issues.push({
				code: "PLATFORM_INSTALL_BIN_MISSING",
				message: "platform-cli must expose the platform executable",
			});
		}
	} else {
		const selfInstallBin = packageBinEntry(metadata, descriptor.packageName);
		if (selfInstallBin === undefined) {
			issues.push({
				code: "SELF_INSTALL_BIN_MISSING",
				message: `package must expose ${packageExecutableName(descriptor.packageName)} so npx <package> install has a stable entry`,
			});
		} else if (selfInstallBin === "./self-install.mjs") {
			if (!(await pathExists(join(packageDirectory, "self-install.mjs")))) {
				issues.push({
					code: "SELF_INSTALL_ENTRY_MISSING",
					message: "self-install.mjs bin target is missing",
				});
			}
			if (!stringArrayIncludes(metadata.files, "self-install.mjs")) {
				issues.push({
					code: "SELF_INSTALL_NOT_PUBLISHED",
					message: "self-install.mjs must be included in the npm files allowlist",
				});
			}
		}
	}
	if (
		typeof metadata.publishConfig !== "object" ||
		metadata.publishConfig === null ||
		Reflect.get(metadata.publishConfig, "access") !== "public"
	) {
		issues.push({
			code: "PUBLISH_ACCESS_INVALID",
			message: "scoped Module package must publish with public access",
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
	try {
		const conformance = await readJson(
			join(packageDirectory, "conformance.json"),
		);
		if (
			typeof conformance !== "object" ||
			conformance === null ||
			Reflect.get(conformance, "contract") !== "proflow.conformance.v1" ||
			JSON.stringify(Reflect.get(conformance, "levels")) !==
				JSON.stringify(["C1", "C2", "C3"])
		) {
			issues.push({
				code: "CONFORMANCE_METADATA_INVALID",
				message: "conformance metadata is invalid",
			});
		}
		const generated =
			typeof conformance === "object" && conformance !== null
				? Reflect.get(conformance, "generatedArtifact")
				: undefined;
		if (
			generated !== undefined &&
			(typeof generated !== "object" ||
				generated === null ||
				Reflect.get(generated, "source") !==
					"@tomflow/proflow-module-template" ||
				Reflect.get(generated, "templateVersion") !==
					descriptor.templateVersion ||
				Reflect.get(generated, "regeneration") !== "materializeModule")
		) {
			issues.push({
				code: "GENERATED_TRUTH_SOURCE_INVALID",
				message: "generated artifact provenance is invalid",
			});
		}
	} catch {
		issues.push({
			code: "CONFORMANCE_METADATA_INVALID",
			message: "conformance metadata cannot be parsed",
		});
	}
	const adapterEntry = exportEntry(metadata, "./deployment/adapter");
	if (
		adapterEntry === undefined ||
		!(await pathExists(resolve(packageDirectory, adapterEntry)))
	) {
		issues.push({
			code: "ADAPTER_EXPORT_INVALID",
			message: "public behavior adapter export is missing",
		});
	}
	const descriptorEntry = exportEntry(metadata, "./deployment/descriptor");
	if (
		descriptorEntry === undefined ||
		!(await pathExists(resolve(packageDirectory, descriptorEntry)))
	) {
		issues.push({
			code: "DESCRIPTOR_EXPORT_INVALID",
			message: "public descriptor export is missing",
		});
	}
	if (
		parsedProflow.success &&
		descriptorEntry !== undefined &&
		parsedProflow.data.descriptor !== descriptorEntry
	) {
		issues.push({
			code: "DESCRIPTOR_METADATA_MISMATCH",
			message: "package.json.proflow.descriptor must match the public descriptor export",
		});
	}
	for (const entry of descriptor.documentation) {
		if (
			isPackageRelativePath(entry.path) &&
			!(await pathExists(resolve(packageDirectory, entry.path)))
		) {
			issues.push({
				code: "DOCUMENTATION_ENTRY_MISSING",
				message: `documentation ${entry.id} does not resolve to a package file`,
			});
		}
	}
	const cliEntry = exportEntry(metadata, "./cli");
	if (descriptor.kind === "service") {
		const serviceBin = packageBinEntry(metadata, descriptor.packageName);
		if (cliEntry === undefined || !(await pathExists(resolve(packageDirectory, cliEntry)))) {
			issues.push({
				code: "SERVICE_CLI_MISSING",
				message: "service package must publish its package-owned CLI through ./cli",
			});
		}
		if (serviceBin === undefined || cliEntry === undefined || serviceBin !== cliEntry) {
			issues.push({
				code: "SERVICE_BIN_MISMATCH",
				message: "service package bin must point to the same package-owned CLI exported as ./cli",
			});
		}
		try {
			const adapterSource = await readFile(join(packageDirectory, "deployment/adapter.ts"), "utf8");
			if (!/export\s+(?:async\s+)?function\s+createServiceProcessBinding\b/.test(adapterSource)) {
				issues.push({
					code: "SERVICE_PROCESS_BINDING_MISSING",
					message: "service adapter must export createServiceProcessBinding",
				});
			}
		} catch {
			issues.push({
				code: "SERVICE_PROCESS_BINDING_MISSING",
				message: "service adapter source cannot be read",
			});
		}
	}
	if (
		descriptor.kind === "cli" &&
		(cliEntry === undefined ||
			!(await pathExists(resolve(packageDirectory, cliEntry))))
	) {
		issues.push({
			code: "MACHINE_ENTRY_MISSING",
			message: "CLI machine entry is missing",
		});
	}
	if (descriptor.kind === "cli" && cliEntry !== undefined) {
		try {
			const cliUrl = pathToFileURL(resolve(packageDirectory, cliEntry));
			cliUrl.searchParams.set("conformance", `${Date.now()}`);
			const cliModule: unknown =
				await /* architecture-allow-local-file-url-import */ import(
					cliUrl.href
				);
			const runCli =
				typeof cliModule === "object" && cliModule !== null
					? Reflect.get(cliModule, "runCli")
					: undefined;
			if (typeof runCli !== "function") {
				issues.push({
					code: "MACHINE_ENTRY_INVALID",
					message: "CLI must export runCli",
				});
			} else {
				const output: unknown = await runCli(["--json"]);
				const parsedOutput: unknown =
					typeof output === "string" ? JSON.parse(output) : undefined;
				if (!moduleOperationResultSchema.safeParse(parsedOutput).success) {
					issues.push({
						code: "MACHINE_RESULT_INVALID",
						message: "CLI JSON output must use the structured result contract",
					});
				}
			}
		} catch {
			issues.push({
				code: "MACHINE_ENTRY_INVALID",
				message: "CLI machine entry cannot execute",
			});
		}
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
	try {
		const compilerOptions = await compilerOptionsFor(
			join(packageDirectory, "tsconfig.json"),
		);
		if (compilerOptions.strict !== true || compilerOptions.noEmit !== true) {
			issues.push({
				code: "TYPESCRIPT_GATE_INVALID",
				message: "package must enable strict/noEmit",
			});
		}
	} catch {
		issues.push({
			code: "TYPESCRIPT_GATE_INVALID",
			message: "tsconfig cannot be parsed",
		});
	}
	for (const file of await sourceFiles(packageDirectory)) {
		if (/\/(?:tests?|node_modules)\//.test(file)) continue;
		if (!/\.(?:ts|js|json)$/.test(file)) continue;
		const content = await readFile(file, "utf8");
		if (
			/\b(?:apiKey|apiToken|password|secret)\s*[:=]\s*["'][^"']+["']/.test(
				content,
			)
		) {
			issues.push({
				code: "PUBLISH_ARTIFACT_SECRET",
				message: `plaintext secret in ${file}`,
			});
		}
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
			parsedResult.success &&
			parsedResult.data.moduleRef !== descriptor.moduleRef
		) {
			issues.push({
				code: "RESULT_MODULE_MISMATCH",
				message: `${primitive} result.moduleRef differs from descriptor`,
			});
		}
		if (
			parsedResult.success &&
			parsedResult.data.moduleVersion !== descriptor.moduleVersion
		) {
			issues.push({
				code: "RESULT_VERSION_MISMATCH",
				message: `${primitive} result.moduleVersion differs from descriptor`,
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
		const declaredEffects = new Set(
			descriptor.effects.map((effect) => effect.description),
		);
		for (const effect of observation.observedEffects) {
			if (!declaredEffects.has(effect))
				issues.push({
					code: "EFFECT_NOT_DECLARED",
					message: `${primitive} observed effect is not bound to descriptor: ${effect}`,
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

async function loadGeneratedDescriptor(
	packageDirectory: string,
): Promise<unknown> {
	const url = pathToFileURL(join(packageDirectory, "deployment/descriptor.ts"));
	url.searchParams.set("conformance", `${Date.now()}-${Math.random()}`);
	const loaded: unknown =
		await /* architecture-allow-local-file-url-import */ import(url.href);
	return typeof loaded === "object" && loaded !== null
		? Reflect.get(loaded, "descriptor")
		: undefined;
}

async function loadGeneratedAdapter(
	packageDirectory: string,
): Promise<BehaviorAdapter> {
	const url = pathToFileURL(join(packageDirectory, "deployment/adapter.ts"));
	url.searchParams.set("conformance", `${Date.now()}-${Math.random()}`);
	const loaded: unknown =
		await /* architecture-allow-local-file-url-import */ import(url.href);
	const adapter =
		typeof loaded === "object" && loaded !== null
			? Reflect.get(loaded, "behaviorAdapter")
			: undefined;
	if (typeof adapter !== "object" || adapter === null) {
		throw new TypeError("generated package behaviorAdapter is missing");
	}
	return adapter as BehaviorAdapter;
}

export async function runGeneratedPackageConformance(
	packageDirectory: string,
): Promise<
	[ConformanceGateResult, ConformanceGateResult, ConformanceGateResult]
> {
	let descriptorInput: unknown;
	try {
		descriptorInput = await loadGeneratedDescriptor(packageDirectory);
	} catch {
		const failure = gate("C1", [
			{
				code: "DESCRIPTOR_LOAD_FAILED",
				message: "generated descriptor cannot be loaded",
			},
		]);
		return [
			failure,
			gate("C2", [
				{ code: "C1_REQUIRED", message: "C2 requires a valid descriptor" },
			]),
			gate("C3", [
				{ code: "C1_REQUIRED", message: "C3 requires a valid descriptor" },
			]),
		];
	}
	const c1 = runStaticConformance(descriptorInput);
	const parsed = moduleDescriptorSchema.safeParse(descriptorInput);
	if (!parsed.success || c1.status === "FAIL") {
		return [
			c1,
			gate("C2", [{ code: "C1_REQUIRED", message: "C2 requires C1 PASS" }]),
			gate("C3", [{ code: "C1_REQUIRED", message: "C3 requires C1 PASS" }]),
		];
	}
	const c2 = await runPackageConformance(packageDirectory, parsed.data);
	if (c2.status === "FAIL") {
		return [
			c1,
			c2,
			gate("C3", [{ code: "C2_REQUIRED", message: "C3 requires C2 PASS" }]),
		];
	}
	try {
		const adapter = await loadGeneratedAdapter(packageDirectory);
		return [c1, c2, await runBehaviorConformance(parsed.data, adapter)];
	} catch {
		return [
			c1,
			c2,
			gate("C3", [
				{
					code: "ADAPTER_LOAD_FAILED",
					message: "generated adapter cannot be loaded",
				},
			]),
		];
	}
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

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
	type ModuleDescriptor,
	type ModuleKind,
	parseModuleDescriptor,
} from "@tomflow/proflow-module-contract";

export const CURRENT_TEMPLATE_VERSION = "1.0.0";

export interface MaterializeModuleInput {
	targetDirectory: string;
	moduleRef: string;
	packageName: string;
	kind: ModuleKind;
	moduleVersion?: string;
	platformCompatibility?: string;
}

export interface MaterializeModuleResult {
	packageDirectory: string;
	descriptor: ModuleDescriptor;
	files: string[];
	packageMetadata: GeneratedPackageMetadata;
	machineEntry?: string;
}

export interface GeneratedPackageMetadata {
	name: string;
	version: string;
	type: "module";
	private?: boolean;
	publishConfig: { access: "public" };
	exports: Record<string, string>;
}

export interface GeneratedBehaviorObservation {
	result: {
		contract: "deployment.result.v1";
		ok: boolean;
		status: "SUCCEEDED" | "BLOCKED" | "ACTION_REQUIRED" | "FAILED";
		moduleRef: string;
		moduleVersion: string;
		checks?: Array<{ id: string; status: "PASS" | "FAIL"; message: string }>;
		actionRequired?: { action: string; description: string };
	};
	observedEffects: string[];
	externalAvailabilityClaim?: "UNKNOWN" | "AVAILABLE" | "UNAVAILABLE";
	externalAvailabilityEvidence?: "none" | "fake" | "real";
}

export type GeneratedBehaviorAdapter = Partial<
	Record<
		ModuleDescriptor["lifecycle"]["supported"][number],
		() => GeneratedBehaviorObservation | Promise<GeneratedBehaviorObservation>
	>
>;

const lifecycleByKind: Record<
	ModuleKind,
	ModuleDescriptor["lifecycle"]["supported"]
> = {
	library: ["describe", "preflight", "verify", "doctor"],
	service: [
		"describe",
		"preflight",
		"status",
		"verify",
		"doctor",
		"start",
		"stop",
		"restart",
	],
	cli: ["describe", "preflight", "verify", "doctor"],
	"browser-extension": ["describe", "preflight", "status", "verify", "doctor"],
	"agent-package": ["describe", "preflight", "status", "verify", "doctor"],
	"external-resource": ["describe", "preflight", "status", "verify", "doctor"],
};

function effectsFor(kind: ModuleKind): ModuleDescriptor["effects"] {
	switch (kind) {
		case "service":
			return [
				{ kind: "process", description: "Manage the declared service process" },
			];
		case "browser-extension":
			return [
				{
					kind: "external-resource",
					description: "Package a browser extension deployment unit",
				},
			];
		case "agent-package":
			return [
				{
					kind: "external-resource",
					description: "Register an agent package through an explicit action",
				},
			];
		case "external-resource":
			return [
				{
					kind: "external-resource",
					description: "Observe the configured external resource",
				},
			];
		default:
			return [];
	}
}

function requirementsFor(kind: ModuleKind): ModuleDescriptor["requirements"] {
	if (kind === "browser-extension") {
		return [{ kind: "runtime", runtime: "browser", versionRange: ">=1" }];
	}
	return [{ kind: "runtime", runtime: "node", versionRange: ">=24.19.0" }];
}

function descriptorFor(input: MaterializeModuleInput): ModuleDescriptor {
	if (!/^@tomflow\/proflow-[a-z][a-z0-9-]*$/.test(input.packageName)) {
		throw new TypeError(
			"formal ProFlow Module packages must match @tomflow/proflow-*",
		);
	}
	return parseModuleDescriptor({
		contract: "module",
		contractVersion: "1.0.0",
		moduleRef: input.moduleRef,
		packageName: input.packageName,
		moduleVersion: input.moduleVersion ?? "0.1.0",
		kind: input.kind,
		templateVersion: CURRENT_TEMPLATE_VERSION,
		platformCompatibility: input.platformCompatibility ?? ">=1.0.0 <2.0.0",
		provides: [],
		requires: [],
		requirements: requirementsFor(input.kind),
		configSlots:
			input.kind === "external-resource"
				? [
						{
							key: "resourceUrl",
							type: "url",
							required: true,
							description:
								"External resource endpoint configured at deployment time",
						},
					]
				: [],
		lifecycle: { supported: lifecycleByKind[input.kind] },
		verification: {
			checks: [
				{
					id: "module-loads",
					description: "The generated module entry loads",
					lifecycle: "verify",
				},
			],
		},
		effects: effectsFor(input.kind),
	});
}

function packageMetadata(
	descriptor: ModuleDescriptor,
): GeneratedPackageMetadata {
	const exports: Record<string, string> = {
		".": "./src/index.ts",
		"./deployment/adapter": "./deployment/adapter.ts",
		"./deployment/descriptor": "./deployment/descriptor.ts",
	};
	if (descriptor.kind === "cli") exports["./cli"] = "./src/cli.ts";
	return {
		name: descriptor.packageName,
		version: descriptor.moduleVersion,
		type: "module",
		publishConfig: { access: "public" },
		exports,
	};
}

function packageJson(descriptor: ModuleDescriptor): string {
	return `${JSON.stringify(
		{
			...packageMetadata(descriptor),
			files: ["src", "deployment", "conformance.json", "README.md"],
			engines: { node: "24.19.0" },
			scripts: {
				typecheck: "tsc --noEmit",
				test: "node --test tests/**/*.test.ts",
			},
			devDependencies: { typescript: "7.0.2" },
		},
		null,
		2,
	)}\n`;
}

function descriptorSource(descriptor: ModuleDescriptor): string {
	return `export const descriptor = ${JSON.stringify(descriptor, null, 2)} as const;\n`;
}

function operationSource(
	descriptor: ModuleDescriptor,
	primitive: ModuleDescriptor["lifecycle"]["supported"][number],
): string {
	if (descriptor.kind === "agent-package" && primitive === "status") {
		return `() => ({ result: { ...baseResult, ok: false, status: "ACTION_REQUIRED", actionRequired: { action: "register-agent-package", description: "Register the generated Agent Package through the authorized carrier" } }, observedEffects: [] })`;
	}
	if (descriptor.kind === "external-resource" && primitive === "status") {
		return `() => ({ result: baseResult, observedEffects: [], externalAvailabilityClaim: "UNKNOWN", externalAvailabilityEvidence: "fake" })`;
	}
	if (primitive === "verify") {
		return `() => ({ result: { ...baseResult, ok: false, status: "FAILED", checks: [{ id: "owner-verification-required", status: "FAIL", message: "Owner-specific verification is not implemented" }], error: { code: "VERIFY_FAILED", message: "Owner-specific verification is not implemented", retryable: false } }, observedEffects: [] })`;
	}
	if (descriptor.kind === "service" && primitive === "status") {
		return `() => ({ result: { ...baseResult, data: { state: serviceStatus() } }, observedEffects: [] })`;
	}
	if (descriptor.kind === "service" && primitive === "start") {
		return `() => ({ result: { ...baseResult, data: { state: serviceStart() } }, observedEffects: ["Manage the declared service process"] })`;
	}
	if (descriptor.kind === "service" && primitive === "stop") {
		return `() => ({ result: { ...baseResult, data: { state: serviceStop() } }, observedEffects: ["Manage the declared service process"] })`;
	}
	if (descriptor.kind === "service" && primitive === "restart") {
		return `() => ({ result: { ...baseResult, data: { state: serviceRestart() } }, observedEffects: ["Manage the declared service process"] })`;
	}
	return `() => ({ result: baseResult, observedEffects: [] })`;
}

function adapterSource(descriptor: ModuleDescriptor): string {
	const imports =
		descriptor.kind === "service"
			? 'import { restart as serviceRestart, start as serviceStart, status as serviceStatus, stop as serviceStop } from "../src/lifecycle.ts";\n\n'
			: "";
	const operations = descriptor.lifecycle.supported
		.map(
			(primitive) =>
				`\t${JSON.stringify(primitive)}: ${operationSource(descriptor, primitive)},`,
		)
		.join("\n");
	return `${imports}const baseResult = {
\tcontract: "deployment.result.v1",
\tok: true,
\tstatus: "SUCCEEDED",
\tmoduleRef: ${JSON.stringify(descriptor.moduleRef)},
\tmoduleVersion: ${JSON.stringify(descriptor.moduleVersion)},
} as const;

export const behaviorAdapter = {
${operations}
} as const;
`;
}

function profileFiles(descriptor: ModuleDescriptor): Record<string, string> {
	switch (descriptor.kind) {
		case "service":
			return {
				"src/lifecycle.ts": `export type ServiceState = "STOPPED" | "RUNNING";\n\nlet state: ServiceState = "STOPPED";\n\nexport function status(): ServiceState {\n\treturn state;\n}\n\nexport function start(): ServiceState {\n\tstate = "RUNNING";\n\treturn state;\n}\n\nexport function stop(): ServiceState {\n\tstate = "STOPPED";\n\treturn state;\n}\n\nexport function restart(): ServiceState {\n\tstop();\n\treturn start();\n}\n`,
			};
		case "cli":
			return {
				"src/cli.ts": `export interface CliResult {\n\tcontract: "deployment.result.v1";\n\tok: boolean;\n\tstatus: "SUCCEEDED";\n\tmoduleRef: string;\n\tmoduleVersion: string;\n}\n\nexport function runCli(args: readonly string[]): string {\n\tif (!args.includes("--json")) throw new TypeError("--json is required");\n\tconst result: CliResult = { contract: "deployment.result.v1", ok: true, status: "SUCCEEDED", moduleRef: ${JSON.stringify(descriptor.moduleRef)}, moduleVersion: ${JSON.stringify(descriptor.moduleVersion)} };\n\treturn JSON.stringify(result);\n}\n`,
			};
		case "browser-extension":
			return {
				"deployment/browser-extension.json": `${JSON.stringify({ manifestVersion: 3, statusAdapter: "deployment/adapter.ts", verificationAdapter: "deployment/adapter.ts" }, null, 2)}\n`,
			};
		case "agent-package":
			return {
				"deployment/agent-package.md":
					"# Agent package deployment\n\nRegistration is an explicit ACTION_REQUIRED integration.\n",
				"deployment/agent-package.json": `${JSON.stringify({ registration: "ACTION_REQUIRED", adapter: "deployment/adapter.ts" }, null, 2)}\n`,
			};
		case "external-resource":
			return {
				"src/resource-adapter.ts": `export interface ResourceObservation {\n\tavailable: boolean;\n\tresourceVersion?: string;\n}\n\nexport function observe(input: unknown): ResourceObservation {\n\tif (typeof input !== "object" || input === null || !("available" in input) || typeof input.available !== "boolean") {\n\t\tthrow new TypeError("invalid external resource observation");\n\t}\n\treturn { available: input.available };\n}\n`,
			};
		default:
			return {};
	}
}

function commonFiles(descriptor: ModuleDescriptor): Record<string, string> {
	return {
		"package.json": packageJson(descriptor),
		"README.md": `# ${descriptor.packageName}\n\nModule: \`${descriptor.moduleRef}\`  \nKind: \`${descriptor.kind}\`  \nTemplate: \`${descriptor.templateVersion}\`\n`,
		"tsconfig.json": `${JSON.stringify(
			{
				compilerOptions: {
					target: "ESNext",
					module: "NodeNext",
					moduleResolution: "NodeNext",
					strict: true,
					noEmit: true,
					erasableSyntaxOnly: true,
					verbatimModuleSyntax: true,
					allowImportingTsExtensions: true,
					noUncheckedIndexedAccess: true,
					exactOptionalPropertyTypes: true,
					skipLibCheck: true,
				},
				include: ["src/**/*.ts", "tests/**/*.ts", "deployment/**/*.ts"],
			},
			null,
			2,
		)}\n`,
		"src/index.ts": `export const moduleRef = ${JSON.stringify(descriptor.moduleRef)};\n`,
		"tests/smoke.test.ts": `import { moduleRef } from "../src/index.ts";\n\nconst observed: string = moduleRef;\nvoid observed;\n`,
		"deployment/descriptor.ts": descriptorSource(descriptor),
		"deployment/requirements.ts": `import { descriptor } from "./descriptor.ts";\n\nexport const requirements = descriptor.requirements;\n`,
		"deployment/verification.ts": `import { descriptor } from "./descriptor.ts";\n\nexport const verification = descriptor.verification;\n`,
		"deployment/adapter.ts": adapterSource(descriptor),
		"conformance.json": `${JSON.stringify(
			{
				contract: "proflow.conformance.v1",
				levels: ["C1", "C2", "C3"],
				generatedArtifact: {
					source: "@tomflow/proflow-module-template",
					templateVersion: descriptor.templateVersion,
					regeneration: "materializeModule",
				},
			},
			null,
			2,
		)}\n`,
	};
}

export async function materializeModule(
	input: MaterializeModuleInput,
): Promise<MaterializeModuleResult> {
	const descriptor = descriptorFor(input);
	const metadata = packageMetadata(descriptor);
	const packageDirectory = resolve(input.targetDirectory, input.moduleRef);
	const files = { ...commonFiles(descriptor), ...profileFiles(descriptor) };
	for (const [relativePath, content] of Object.entries(files)) {
		const destination = join(packageDirectory, relativePath);
		await mkdir(resolve(destination, ".."), { recursive: true });
		await writeFile(destination, content, { encoding: "utf8", flag: "wx" });
	}
	return {
		packageDirectory,
		descriptor,
		files: Object.keys(files).sort(),
		packageMetadata: metadata,
		...(input.kind === "cli" ? { machineEntry: "src/cli.ts" } : {}),
	};
}

export async function loadGeneratedBehaviorAdapter(
	packageDirectory: string,
): Promise<GeneratedBehaviorAdapter> {
	const moduleUrl = pathToFileURL(
		join(packageDirectory, "deployment/adapter.ts"),
	);
	moduleUrl.searchParams.set("loadedAt", `${Date.now()}-${Math.random()}`);
	const loaded: unknown =
		await /* architecture-allow-local-file-url-import */ import(moduleUrl.href);
	if (typeof loaded !== "object" || loaded === null) {
		throw new TypeError("generated adapter module is invalid");
	}
	const adapter = Reflect.get(loaded, "behaviorAdapter");
	if (typeof adapter !== "object" || adapter === null) {
		throw new TypeError("generated package does not export behaviorAdapter");
	}
	return adapter as GeneratedBehaviorAdapter;
}

export interface TemplateMigrationInput {
	currentVersion: string;
	targetVersion: string;
	contractCompatible: boolean;
	platformCompatible: boolean;
	mandatoryRequirement: boolean;
}

export interface TemplateMigrationAssessment {
	required: boolean;
	reasons: string[];
	reconformanceRequired: boolean;
}

export function assessTemplateMigration(
	input: TemplateMigrationInput,
): TemplateMigrationAssessment {
	const reasons: string[] = [];
	if (!input.contractCompatible) reasons.push("contract incompatibility");
	if (!input.platformCompatible) reasons.push("platform incompatibility");
	if (input.mandatoryRequirement)
		reasons.push("mandatory engineering requirement");
	const required =
		input.currentVersion !== input.targetVersion && reasons.length > 0;
	return {
		required,
		reasons: required ? reasons : [],
		reconformanceRequired: required,
	};
}

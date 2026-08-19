import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
	type ModuleDescriptor,
	type ModuleKind,
	type ModuleOperationResult,
	parseModuleDescriptor,
} from "@tomflow/proflow-module-contract";

export const CURRENT_TEMPLATE_VERSION = "1.0.0";

export interface MaterializeModuleInput {
	targetDirectory: string;
	moduleRef: string;
	packageName: string;
	kind: ModuleKind;
	domain: string;
	summary: string;
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
	description: string;
	keywords: string[];
	publishConfig: { access: "public" };
	exports: Record<string, string>;
	bin: Record<string, string>;
	proflow: {
		module: true;
			descriptor: "./dist/deployment/descriptor.js";
		manifest: "./proflow.module.json";
	};
}

export interface GeneratedBehaviorObservation {
	result: ModuleOperationResult;
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
	library: ["describe", "preflight", "status"],
	service: ["describe", "preflight", "status", "start", "stop"],
	cli: ["describe", "preflight", "status"],
	"browser-extension": ["describe", "preflight", "status"],
	"agent-package": ["describe", "preflight", "status"],
	"external-resource": ["describe", "preflight", "status"],
};

function effectsFor(kind: ModuleKind): ModuleDescriptor["effects"] {
	switch (kind) {
		case "service":
			return [
				{
					kind: "process",
					description: "Manage the declared service process",
					retention: "remove",
				},
			];
		case "browser-extension":
			return [
				{
					kind: "external-resource",
					description: "Package a browser extension deployment unit",
					retention: "preserve",
				},
			];
		case "agent-package":
			return [
				{
					kind: "external-resource",
					description: "Register an agent package through an explicit action",
					retention: "preserve",
				},
			];
		case "external-resource":
			return [
				{
					kind: "external-resource",
					description: "Observe the configured external resource",
					retention: "preserve",
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
		identity: {
			domain: input.domain,
			summary: input.summary,
		},
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
					lifecycle: "status",
				},
			],
		},
		effects: effectsFor(input.kind),
		documentation: [
			{
				id: "overview",
				path: "./README.md",
				description: "Package-owned module overview",
			},
		],
	});
}

function packageMetadata(
	descriptor: ModuleDescriptor,
): GeneratedPackageMetadata {
	const exports: Record<string, string> = {
		".": "./dist/src/index.js",
		"./deployment/adapter": "./dist/deployment/adapter.js",
		"./deployment/descriptor": "./dist/deployment/descriptor.js",
	};
	if (descriptor.kind === "cli" || descriptor.kind === "service")
		exports["./cli"] = "./dist/src/cli.js";
	const unscopedName = descriptor.packageName.slice("@tomflow/".length);
	return {
		name: descriptor.packageName,
		version: descriptor.moduleVersion,
		type: "module",
		description: descriptor.identity.summary,
		keywords: ["proflow", "proflow-module", descriptor.identity.domain],
		publishConfig: { access: "public" },
		exports,
		bin:
			descriptor.kind === "service" || descriptor.kind === "cli"
				? { [unscopedName]: "./dist/src/cli.js" }
				: {},
		proflow: {
			module: true,
			descriptor: "./dist/deployment/descriptor.js",
			manifest: "./proflow.module.json",
		},
	};
}

function packageJson(descriptor: ModuleDescriptor): string {
	return `${JSON.stringify(
		{
			...packageMetadata(descriptor),
			files: [
				"dist",
				"conformance.json",
				"README.md",
				"proflow.module.json",
			],
			engines: { node: "24.19.0" },
			scripts: {
				build: "tsc -p tsconfig.build.json",
				typecheck: "tsc --noEmit",
				test: "node --test tests/**/*.test.ts",
			},
			devDependencies: { typescript: "7.0.2", "@types/node": "24.10.1" },
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
	if (primitive === "status") {
		const status =
			descriptor.configSlots.length > 0
				? `{ configStatus: "INCOMPLETE", missingConfig: ${JSON.stringify(descriptor.configSlots.filter((slot) => slot.required).map((slot) => slot.key))}, runtimeStatus: "UNKNOWN" }`
				: `{ configStatus: "READY", runtimeStatus: "UNKNOWN" }`;
		return `() => ({ result: { ...baseResult, data: ${status} }, observedEffects: [] })`;
	}
	if (
		descriptor.kind === "service" &&
		["start", "stop"].includes(primitive)
	) {
		return `() => ({ result: { ...baseResult, ok: false, status: "ACTION_REQUIRED", actionRequired: { action: "implement-service-lifecycle", description: "Owner must implement the package-owned production lifecycle before this operation is available" } }, observedEffects: [] })`;
	}
	return `() => ({ result: baseResult, observedEffects: [] })`;
}

function adapterSource(descriptor: ModuleDescriptor): string {
	const imports = "";
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
\t\tcase "service":
			return {
				"src/cli.ts": `#!/usr/bin/env node
function main(): void {
	const [command, configPath, ...rest] = process.argv.slice(2);
	const usage = "Usage: ${descriptor.packageName} start /absolute/config.json\\n";
	if (command === "--help" || command === "-h") {
		process.stdout.write(usage);
		return;
	}
	if (command !== "start" || configPath === undefined || rest.length > 0) {
		process.stderr.write(usage);
		process.exit(2);
	}
	throw new Error(
		"OWNER_IMPLEMENTATION_REQUIRED: implement the package-owned service process entrypoint before start is allowed",
	);
}
if (import.meta.main) main();
`,
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
		"README.md": `# ${descriptor.packageName}\n\nModule: \`${descriptor.moduleRef}\`  \nDomain: \`${descriptor.identity.domain}\`  \nKind: \`${descriptor.kind}\`  \nTemplate: \`${descriptor.templateVersion}\`\n\n${descriptor.identity.summary}\n`,
		"tsconfig.json": `${JSON.stringify(
			{
				compilerOptions: {
					target: "ESNext",
					module: "NodeNext",
					moduleResolution: "NodeNext",
					types: ["node"],
					strict: true,
					noEmit: true,
					erasableSyntaxOnly: true,
					verbatimModuleSyntax: true,
					allowImportingTsExtensions: true,
					noUncheckedIndexedAccess: true,
					exactOptionalPropertyTypes: true,
					skipLibCheck: true,
				},
				include: ["src/**/*.ts", "deployment/**/*.ts"],
			},
			null,
			2,
		)}\n`,
		"tsconfig.build.json": `${JSON.stringify(
			{
				extends: "./tsconfig.json",
				compilerOptions: {
					noEmit: false,
					declaration: true,
					rootDir: ".",
					outDir: "dist",
					rewriteRelativeImportExtensions: true,
				},
				exclude: ["tests/**"],
			},
			null,
			2,
		)}\n`,
		"src/index.ts": `export const moduleRef = ${JSON.stringify(descriptor.moduleRef)};\n`,
		"tests/smoke.test.ts": `import { moduleRef } from "../src/index.ts";\n\nconst observed: string = moduleRef;\nvoid observed;\n`,
		"proflow.module.json": `${JSON.stringify(descriptor, null, 2)}\n`,
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
	const targetRoot = resolve(input.targetDirectory);
	const packageDirectory = resolve(targetRoot, input.moduleRef);
	const files = { ...commonFiles(descriptor), ...profileFiles(descriptor) };
	await mkdir(targetRoot, { recursive: true });
	await mkdir(packageDirectory);
	try {
		for (const [relativePath, content] of Object.entries(files)) {
			const destination = join(packageDirectory, relativePath);
			await mkdir(resolve(destination, ".."), { recursive: true });
			await writeFile(destination, content, { encoding: "utf8", flag: "wx" });
		}
	} catch (error) {
		await rm(packageDirectory, { recursive: true, force: true });
		throw error;
	}
	return {
		packageDirectory,
		descriptor,
		files: Object.keys(files).sort(),
		packageMetadata: metadata,
		...(input.kind === "cli" ? { machineEntry: "dist/src/cli.js" } : {}),
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
	if (!isGeneratedBehaviorAdapter(adapter)) {
		throw new TypeError("generated package does not export behaviorAdapter");
	}
	return adapter;
}

function isGeneratedBehaviorAdapter(
	value: unknown,
): value is GeneratedBehaviorAdapter {
	if (typeof value !== "object" || value === null) return false;
	return Object.values(value).every((entry) => typeof entry === "function");
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

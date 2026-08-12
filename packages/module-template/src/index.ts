import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

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
}

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
		configSlots: [],
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

function packageJson(descriptor: ModuleDescriptor): string {
	return `${JSON.stringify(
		{
			name: descriptor.packageName,
			version: descriptor.moduleVersion,
			private: true,
			type: "module",
			exports: { ".": "./src/index.ts" },
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

function profileFiles(kind: ModuleKind): Record<string, string> {
	switch (kind) {
		case "service":
			return {
				"src/lifecycle.ts": `export type ServiceState = "STOPPED" | "RUNNING";\n\nexport function status(state: ServiceState): ServiceState {\n\treturn state;\n}\n\nexport function start(): ServiceState {\n\treturn "RUNNING";\n}\n\nexport function stop(): ServiceState {\n\treturn "STOPPED";\n}\n`,
			};
		case "cli":
			return {
				"src/cli.ts": `export interface CliResult {\n\tcontract: "deployment.result.v1";\n\tok: boolean;\n}\n\nexport function run(): CliResult {\n\treturn { contract: "deployment.result.v1", ok: true };\n}\n`,
			};
		case "browser-extension":
			return {
				"deployment/browser-extension.json": `${JSON.stringify({ manifestVersion: 3, statusAdapter: "src/index.ts" }, null, 2)}\n`,
			};
		case "agent-package":
			return {
				"deployment/agent-package.md":
					"# Agent package deployment\n\nRegistration is an explicit ACTION_REQUIRED integration.\n",
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
		"conformance.json": `${JSON.stringify(
			{ contract: "proflow.conformance.v1", levels: ["C1", "C2", "C3"] },
			null,
			2,
		)}\n`,
	};
}

export async function materializeModule(
	input: MaterializeModuleInput,
): Promise<MaterializeModuleResult> {
	const descriptor = descriptorFor(input);
	const packageDirectory = resolve(input.targetDirectory, input.moduleRef);
	const files = { ...commonFiles(descriptor), ...profileFiles(input.kind) };
	for (const [relativePath, content] of Object.entries(files)) {
		const destination = join(packageDirectory, relativePath);
		await mkdir(resolve(destination, ".."), { recursive: true });
		await writeFile(destination, content, { encoding: "utf8", flag: "wx" });
	}
	return { packageDirectory, descriptor, files: Object.keys(files).sort() };
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

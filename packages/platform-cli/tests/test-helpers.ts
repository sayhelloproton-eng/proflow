import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface FixtureModuleInput {
	moduleRef: string;
	packageName?: string;
	version?: string;
	kind?:
		| "library"
		| "service"
		| "cli"
		| "browser-extension"
		| "agent-package"
		| "external-resource";
	provides?: Array<{ contractRef: string; version: string }>;
	requires?: Array<{
		contractRef: string;
		versionRange: string;
		optional?: boolean;
	}>;
	configSlots?: Array<Record<string, unknown>>;
	statusData?: {
		setupStatus: "READY" | "ACTION_REQUIRED" | "FAILED";
		runtimeStatus: "RUNNING" | "STOPPED" | "FAILED" | "NOT_APPLICABLE";
	};
	docsData?: unknown;
	documents?: Array<{ id: string; path: string; content: string }>;
	adapterSource?: string;
	/** Transitional test input only; standard management is always the fixed seven-command surface. */
	lifecycle?: string[];
}

export async function tempWorkspace(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "proflow-thin-cli-"));
	await writeFile(
		join(root, "package.json"),
		JSON.stringify({ private: true }),
	);
	await writeFile(
		join(root, "pnpm-workspace.yaml"),
		'packages:\n  - "packages/*"\n',
	);
	return root;
}

function descriptorFor(input: FixtureModuleInput) {
	return {
		contract: "module",
		contractVersion: "1.0.0",
		moduleRef: input.moduleRef,
		packageName: input.packageName ?? `@tomflow/proflow-${input.moduleRef}`,
		moduleVersion: input.version ?? "1.0.0",
		kind: input.kind ?? "library",
		templateVersion: "1.0.0",
		platformCompatibility: ">=1.0.0 <2.0.0",
		identity: {
			domain: "deployment-governance",
			summary: "Thin CLI test fixture",
		},
		provides: input.provides ?? [],
		requires: input.requires ?? [],
		requirements: [],
		configSlots: input.configSlots ?? [],
		effects: [],
		documentation: { docs: "DOCS.md", setup: "SETUP.md" },
	};
}

function defaultAdapterSource(input: FixtureModuleInput): string {
	const moduleRef = JSON.stringify(input.moduleRef);
	const version = JSON.stringify(input.version ?? "1.0.0");
	const status = JSON.stringify(
		input.statusData ?? {
			setupStatus: "READY",
			runtimeStatus: "NOT_APPLICABLE",
		},
	);
	const docs = JSON.stringify(
		input.docsData ?? { docs: "DOCS.md", setup: "SETUP.md" },
	);
	const base = `{ contract: "deployment.result.v1", ok: true, status: "SUCCEEDED", moduleRef: ${moduleRef}, moduleVersion: ${version} }`;
	return `export const behaviorAdapter = {
install: async () => ({ result: ${base}, observedEffects: [] }),
uninstall: async () => ({ result: ${base}, observedEffects: [] }),
status: async () => ({ result: { ...${base}, data: ${status} }, observedEffects: [] }),
setup: async () => ({ result: ${base}, observedEffects: [] }),
docs: async () => ({ result: { ...${base}, data: ${docs} }, observedEffects: [] }),
start: async () => ({ result: ${base}, observedEffects: [] }),
stop: async () => ({ result: ${base}, observedEffects: [] }),
};\n`;
}

async function writeModule(
	root: string,
	input: FixtureModuleInput,
	installed: boolean,
): Promise<void> {
	const packageName =
		input.packageName ?? `@tomflow/proflow-${input.moduleRef}`;
	const version = input.version ?? "1.0.0";
	const packageRoot = installed
		? join(
				root,
				"node_modules",
				"@tomflow",
				packageName.slice("@tomflow/".length),
			)
		: join(root, "packages", input.moduleRef);
	await mkdir(join(packageRoot, "deployment"), { recursive: true });
	await writeFile(
		join(packageRoot, "package.json"),
		JSON.stringify({
			name: packageName,
			version,
			type: "module",
			...(installed
				? {
						exports: {
							"./deployment/descriptor": "./deployment/descriptor.js",
							"./deployment/adapter": "./deployment/adapter.js",
						},
					}
				: {}),
			proflow: {
				module: true,
				descriptor: installed
					? "./deployment/descriptor.js"
					: "./deployment/descriptor.ts",
				manifest: "./proflow.module.json",
			},
		}),
	);
	const extension = installed ? "js" : "ts";
	await writeFile(
		join(packageRoot, "deployment", `descriptor.${extension}`),
		`export const descriptor = ${JSON.stringify(descriptorFor(input))};\n`,
	);
	await writeFile(
		join(packageRoot, "deployment", `adapter.${extension}`),
		input.adapterSource ?? defaultAdapterSource(input),
	);
	await writeFile(join(packageRoot, "DOCS.md"), "# Fixture docs\n");
	await writeFile(join(packageRoot, "SETUP.md"), "# Fixture setup\n");
	for (const document of input.documents ?? [])
		await writeFile(join(packageRoot, document.path), document.content);
}

export const writeWorkspaceModule = (root: string, input: FixtureModuleInput) =>
	writeModule(root, input, false);
export const writeInstalledModule = (root: string, input: FixtureModuleInput) =>
	writeModule(root, input, true);

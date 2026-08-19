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
	lifecycle?: string[];
	statusData?: {
		configStatus: "READY" | "INCOMPLETE" | "INVALID";
		missingConfig?: string[];
		runtimeStatus: "RUNNING" | "STOPPED" | "FAILED" | "UNKNOWN";
	};
	documents?: Array<{ id: string; path: string; content: string }>;
	adapterSource?: string;
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
	const version = input.version ?? "1.0.0";
	const lifecycle = input.lifecycle ?? ["status"];
	const checkLifecycle = lifecycle.includes("status")
		? "status"
		: lifecycle.includes("verify")
			? "verify"
			: "doctor";
	return {
		contract: "module",
		contractVersion: "1.0.0",
		moduleRef: input.moduleRef,
		packageName: input.packageName ?? `@tomflow/proflow-${input.moduleRef}`,
		moduleVersion: version,
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
		lifecycle: { supported: lifecycle },
		verification: {
			checks: [
				{
					id: "fixture-check",
					description: "Fixture observation",
					lifecycle: checkLifecycle,
				},
			],
		},
		effects: [],
		documentation: (input.documents ?? []).map((document) => ({
			id: document.id,
			path: document.path,
			description: `Fixture document ${document.id}`,
		})),
	};
}

function defaultAdapterSource(input: FixtureModuleInput): string {
	const moduleRef = input.moduleRef;
	const version = input.version ?? "1.0.0";
	const statusData = input.statusData ?? {
		configStatus: "READY",
		runtimeStatus: "UNKNOWN",
	};
	const lifecycle = input.lifecycle ?? ["status"];
	const operations = lifecycle.map((primitive) => {
		const data =
			primitive === "status" ? `, data: ${JSON.stringify(statusData)}` : "";
		return `${JSON.stringify(primitive)}: async () => ({ result: { contract: "deployment.result.v1", ok: true, status: "SUCCEEDED", moduleRef: ${JSON.stringify(moduleRef)}, moduleVersion: ${JSON.stringify(version)}${data} }, observedEffects: [] })`;
	});
	return `export const behaviorAdapter = { ${operations.join(",\n")} };\n`;
}

export async function writeWorkspaceModule(
	root: string,
	input: FixtureModuleInput,
): Promise<void> {
	const packageName =
		input.packageName ?? `@tomflow/proflow-${input.moduleRef}`;
	const version = input.version ?? "1.0.0";
	const packageRoot = join(root, "packages", input.moduleRef);
	await mkdir(join(packageRoot, "deployment"), { recursive: true });
	await writeFile(
		join(packageRoot, "package.json"),
		JSON.stringify({
			name: packageName,
			version,
			type: "module",
			proflow: {
				module: true,
				descriptor: "./deployment/descriptor.ts",
				manifest: "./proflow.module.json",
			},
		}),
	);
	await writeFile(
		join(packageRoot, "deployment", "descriptor.ts"),
		`export const descriptor = ${JSON.stringify(descriptorFor(input))} as const;\n`,
	);
	await writeFile(
		join(packageRoot, "deployment", "adapter.ts"),
		input.adapterSource ?? defaultAdapterSource(input),
	);
	for (const document of input.documents ?? []) {
		await writeFile(join(packageRoot, document.path), document.content);
	}
}

export async function writeInstalledModule(
	root: string,
	input: FixtureModuleInput,
): Promise<void> {
	const packageName =
		input.packageName ?? `@tomflow/proflow-${input.moduleRef}`;
	const version = input.version ?? "1.0.0";
	const packageRoot = join(
		root,
		"node_modules",
		"@tomflow",
		packageName.slice("@tomflow/".length),
	);
	await mkdir(join(packageRoot, "deployment"), { recursive: true });
	await writeFile(
		join(packageRoot, "package.json"),
		JSON.stringify({
			name: packageName,
			version,
			type: "module",
			exports: {
				"./deployment/descriptor": "./deployment/descriptor.js",
				"./deployment/adapter": "./deployment/adapter.js",
			},
			proflow: {
				module: true,
				descriptor: "./deployment/descriptor.js",
				manifest: "./proflow.module.json",
			},
		}),
	);
	await writeFile(
		join(packageRoot, "deployment", "descriptor.js"),
		`export const descriptor = ${JSON.stringify(descriptorFor(input))};\n`,
	);
	await writeFile(
		join(packageRoot, "deployment", "adapter.js"),
		input.adapterSource ?? defaultAdapterSource(input),
	);
	for (const document of input.documents ?? []) {
		await writeFile(join(packageRoot, document.path), document.content);
	}
}

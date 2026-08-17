import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { importRawAdapter } from "../src/binding/production-bindings.ts";
import { runCli } from "../src/cli.ts";
import { discoverModules } from "../src/discovery/discover.ts";

// The shipped Platform CLI must construct real production bindings itself — a
// test must not hand-build a Map. This proof drives `runCli(["status", ...])`
// against a real workspace: buildContext → discovery → production binding
// factory → real bound adapter → real HTTP reality, with the unconfigured module
// still failing closed.

interface ModuleFixture {
	moduleRef: string;
	packageName: string;
	kind: "service" | "external-resource";
	withProductionBinding: boolean;
}

const SERVICE_LIFECYCLE = [
	"describe",
	"preflight",
	"status",
	"verify",
	"doctor",
	"start",
	"stop",
];

function descriptorSource(fixture: ModuleFixture): string {
	return `export const descriptor = {
	contract: "module",
	contractVersion: "1.0.0",
	moduleRef: ${JSON.stringify(fixture.moduleRef)},
	packageName: ${JSON.stringify(fixture.packageName)},
	moduleVersion: "1.0.0",
	kind: ${JSON.stringify(fixture.kind)},
	installClass: "optional",
	identity: { domain: "deployment-governance", summary: "Production binder test fixture" },
	templateVersion: "1.0.0",
	platformCompatibility: ">=1.0.0 <2.0.0",
	provides: [],
	requires: [],
	requirements: [],
	configSlots: [],
	lifecycle: { supported: ${JSON.stringify(SERVICE_LIFECYCLE)} },
	verification: { checks: [{ id: "health", description: "Observed health", lifecycle: "verify" }] },
	effects: [],
	documentation: [],
} as const;
`;
}

function serviceAdapterSource(fixture: ModuleFixture): string {
	const ref = fixture.moduleRef;
	return `type Service = {
	status(): Promise<"RUNNING" | "STOPPED">;
	inspect(): Promise<{ readiness: "READY" | "NOT_READY" }>;
	start(): Promise<unknown>;
	stop(): Promise<unknown>;
};
const base = { contract: "deployment.result.v1", ok: true, status: "SUCCEEDED", moduleRef: ${JSON.stringify(ref)}, moduleVersion: "1.0.0" } as const;
const unbound = { ...base, ok: false, status: "ACTION_REQUIRED", actionRequired: { action: "bind-service", description: "No service bound" } } as const;
export function createBehaviorAdapter(input?: { service: Service }) {
	return {
		describe: () => ({ result: base, observedEffects: [] }),
		preflight: () => ({ result: input ? base : unbound, observedEffects: [] }),
		status: async () => ({
			result: input
				? { ...base, data: { processRunning: (await input.service.status()) === "RUNNING" }, checks: [{ id: "runtime", status: (await input.service.status()) === "RUNNING" ? ("PASS" as const) : ("FAIL" as const), message: "runtime" }] }
				: unbound,
			observedEffects: [],
		}),
		verify: async () => ({ result: input ? { ...base, checks: [{ id: "health", status: (await input.service.inspect()).readiness === "READY" ? ("PASS" as const) : ("FAIL" as const), message: "health" }] } : unbound, observedEffects: [] }),
		doctor: () => ({ result: input ? base : unbound, observedEffects: [] }),
		start: async () => ({ result: input ? { ...base, data: await input.service.start() } : unbound, observedEffects: input ? ["start"] : [] }),
		stop: async () => ({ result: input ? (await input.service.stop(), base) : unbound, observedEffects: input ? ["stop"] : [] }),
	};
}
export const behaviorAdapter = createBehaviorAdapter();
export function createProductionBinding(input: { moduleRef: string; config: Record<string, string> }) {
	const url = input.config.statusUrl;
	if (url === undefined || url === "") return undefined;
	const service: Service = {
		async status() {
			try {
				const response = await fetch(url + "/health");
				return response.ok ? "RUNNING" : "STOPPED";
			} catch {
				return "STOPPED";
			}
		},
		async inspect() {
			try {
				const response = await fetch(url + "/health");
				return { readiness: response.ok ? "READY" : "NOT_READY" };
			} catch {
				return { readiness: "NOT_READY" };
			}
		},
		async start() { return { host: "127.0.0.1", port: 0 }; },
		async stop() {},
	};
	return { behaviorAdapter: createBehaviorAdapter({ service }) };
}
`;
}

function resourceAdapterSource(fixture: ModuleFixture): string {
	const ref = fixture.moduleRef;
	return `const base = { contract: "deployment.result.v1", ok: true, status: "SUCCEEDED", moduleRef: ${JSON.stringify(ref)}, moduleVersion: "1.0.0" } as const;
const unbound = { ...base, ok: false, status: "ACTION_REQUIRED", actionRequired: { action: "bind-resource", description: "No resource probe bound" } } as const;
export function createBehaviorAdapter(input?: { probe: () => Promise<{ reachable: boolean; message: string }> }) {
	return {
		describe: () => ({ result: base, observedEffects: [] }),
		preflight: () => ({ result: input ? base : unbound, observedEffects: [] }),
		status: async () => {
			if (!input) return { result: unbound, observedEffects: [] };
			const observation = await input.probe();
			return {
				result: observation.reachable
					? { ...base, checks: [{ id: "resource-status", status: "PASS" as const, message: observation.message }] }
					: { ...unbound, checks: [{ id: "resource-status", status: "FAIL" as const, message: observation.message }] },
				observedEffects: observation.reachable ? ["Observes the external resource"] : [],
			};
		},
		verify: async () => {
			if (!input) return { result: unbound, observedEffects: [] };
			const observation = await input.probe();
			return { result: observation.reachable ? { ...base, checks: [{ id: "resource-verify", status: "PASS" as const, message: observation.message }] } : unbound, observedEffects: [] };
		},
		doctor: () => ({ result: input ? base : unbound, observedEffects: [] }),
	};
}
export const behaviorAdapter = createBehaviorAdapter();
export function createProductionBinding(input: { moduleRef: string; config: Record<string, string> }) {
	const url = input.config.resourceUrl;
	if (url === undefined || url === "") return undefined;
	const probe = async () => {
		try {
			const response = await fetch(url + "/resource");
			return response.ok
				? { reachable: true, message: "resource reachable" }
				: { reachable: false, message: "resource returned " + response.status };
		} catch {
			return { reachable: false, message: "resource unreachable" };
		}
	};
	return { behaviorAdapter: createBehaviorAdapter({ probe }) };
}
`;
}

async function writeFixtureWorkspace(
	root: string,
	fixture: ModuleFixture,
	withProductionBinding: boolean,
): Promise<void> {
	const dir = join(root, "packages", fixture.moduleRef, "deployment");
	await mkdir(dir, { recursive: true });
	await writeFile(
		join(root, "packages", fixture.moduleRef, "package.json"),
		JSON.stringify({
			name: fixture.packageName,
			version: "1.0.0",
			proflow: {
				module: true,
				installClass: "optional",
				descriptor: "./deployment/descriptor.ts",
				manifest: "./proflow.module.json",
				installRequires: [],
			},
		}),
	);
	await writeFile(join(dir, "descriptor.ts"), descriptorSource(fixture));
	await writeFile(
		join(dir, "adapter.ts"),
		withProductionBinding
			? fixture.kind === "service"
				? serviceAdapterSource(fixture)
				: resourceAdapterSource(fixture)
			: `const base = { contract: "deployment.result.v1", ok: true, status: "SUCCEEDED", moduleRef: ${JSON.stringify(fixture.moduleRef)}, moduleVersion: "1.0.0" } as const;
const unbound = { ...base, ok: false, status: "ACTION_REQUIRED", actionRequired: { action: "bind", description: "No binding" } } as const;
export function createBehaviorAdapter() {
	return { describe: () => ({ result: base, observedEffects: [] }), preflight: () => ({ result: unbound, observedEffects: [] }), status: () => ({ result: unbound, observedEffects: [] }), verify: () => ({ result: unbound, observedEffects: [] }), doctor: () => ({ result: unbound, observedEffects: [] }) };
}
export const behaviorAdapter = createBehaviorAdapter();
`,
	);
}

async function writeInstalledResourceFixture(root: string): Promise<void> {
	const packageName = "@tomflow/proflow-installed-res";
	const packageRoot = join(
		root,
		"node_modules",
		"@tomflow",
		"proflow-installed-res",
	);
	const deployment = join(packageRoot, "deployment");
	await mkdir(deployment, { recursive: true });
	await writeFile(
		join(root, "package.json"),
		JSON.stringify({
			name: "production-binder-product-workspace",
			version: "0.0.0",
			private: true,
			dependencies: { [packageName]: "1.0.0" },
		}),
	);
	await writeFile(
		join(packageRoot, "package.json"),
		JSON.stringify({
			name: packageName,
			version: "1.0.0",
			type: "module",
			exports: {
				"./deployment/descriptor": "./deployment/descriptor.js",
				"./deployment/adapter": "./deployment/adapter.js",
			},
			proflow: {
				module: true,
				installClass: "optional",
				descriptor: "./deployment/descriptor.js",
				manifest: "./proflow.module.json",
				installRequires: [],
			},
		}),
	);
	await writeFile(
		join(packageRoot, "proflow.module.json"),
		JSON.stringify({
			contract: "proflow.module-manifest.v1",
			moduleRef: "installed-res",
			packageName,
			moduleVersion: "1.0.0",
			kind: "external-resource",
			installClass: "optional",
			identity: {
				domain: "deployment-governance",
				summary: "Installed production binding fixture",
			},
			templateVersion: "1.0.0",
			platformCompatibility: ">=1.0.0 <2.0.0",
		}),
	);
	await writeFile(
		join(deployment, "descriptor.js"),
		`export const descriptor = {
	contract: "module",
	contractVersion: "1.0.0",
	moduleRef: "installed-res",
	packageName: ${JSON.stringify(packageName)},
	moduleVersion: "1.0.0",
	kind: "external-resource",
	installClass: "optional",
	identity: { domain: "deployment-governance", summary: "Installed production binding fixture" },
	templateVersion: "1.0.0",
	platformCompatibility: ">=1.0.0 <2.0.0",
	provides: [],
	requires: [],
	requirements: [],
	configSlots: [],
	lifecycle: { supported: ["describe", "preflight", "status", "verify", "doctor"] },
	verification: { checks: [{ id: "health", description: "Observed resource health", lifecycle: "verify" }] },
	effects: [],
	documentation: [],
};
`,
	);
	await writeFile(
		join(deployment, "adapter.js"),
		`const base = { contract: "deployment.result.v1", ok: true, status: "SUCCEEDED", moduleRef: "installed-res", moduleVersion: "1.0.0" };
const unbound = { ...base, ok: false, status: "ACTION_REQUIRED", actionRequired: { action: "bind-resource", description: "No installed resource bound" } };
export const behaviorAdapter = {
	describe: () => ({ result: base, observedEffects: [] }),
	preflight: () => ({ result: unbound, observedEffects: [] }),
	status: () => ({ result: unbound, observedEffects: [] }),
	verify: () => ({ result: unbound, observedEffects: [] }),
	doctor: () => ({ result: unbound, observedEffects: [] }),
};
export function createProductionBinding(input) {
	if (!input.config.resourceUrl) return undefined;
	return {
		behaviorAdapter: {
			...behaviorAdapter,
			preflight: () => ({ result: base, observedEffects: [] }),
			status: () => ({ result: { ...base, checks: [{ id: "resource-status", status: "PASS", message: "installed binding resolved from target workspace" }] }, observedEffects: ["Observes installed target-workspace resource"] }),
			verify: () => ({ result: { ...base, checks: [{ id: "health", status: "PASS", message: "installed binding verified" }] }, observedEffects: [] }),
			doctor: () => ({ result: base, observedEffects: [] }),
		},
	};
}
`,
	);
}

interface StatusEntry {
	moduleRef: string;
	result?: { status: string };
}

test("shipped CLI status binds a real service + real external resource and fails closed when unbound", async () => {
	const root = await mkdtemp(join(tmpdir(), "proflow-cli-prodbinder-"));
	let server: Server | undefined;
	try {
		await writeFile(
			join(root, "pnpm-workspace.yaml"),
			'packages:\n  - "packages/*"\n',
		);
		const svc: ModuleFixture = {
			moduleRef: "svc",
			packageName: "@tomflow/proflow-svc",
			kind: "service",
			withProductionBinding: true,
		};
		const res: ModuleFixture = {
			moduleRef: "res",
			packageName: "@tomflow/proflow-res",
			kind: "external-resource",
			withProductionBinding: true,
		};
		const plain: ModuleFixture = {
			moduleRef: "plain",
			packageName: "@tomflow/proflow-plain",
			kind: "service",
			withProductionBinding: false,
		};
		await writeFixtureWorkspace(root, svc, true);
		await writeFixtureWorkspace(root, res, true);
		await writeFixtureWorkspace(root, plain, false);
		await writeInstalledResourceFixture(root);

		server = createServer((request, response) => {
			response.writeHead(200, { "content-type": "application/json" });
			if (request.url?.startsWith("/health"))
				response.end(JSON.stringify({ status: "UP" }));
			else response.end(JSON.stringify({ ok: true }));
		});
		await new Promise<void>((resolve) =>
			server?.listen(0, "127.0.0.1", resolve),
		);
		const address = server.address();
		assert.ok(address && typeof address !== "string");
		const baseUrl = `http://127.0.0.1:${address.port}`;

		await mkdir(join(root, ".proflow", "config"), { recursive: true });
		await writeFile(
			join(root, ".proflow", "config", "svc.json"),
			JSON.stringify({ statusUrl: baseUrl }),
		);
		await writeFile(
			join(root, ".proflow", "config", "res.json"),
			JSON.stringify({ resourceUrl: baseUrl }),
		);
		await writeFile(
			join(root, ".proflow", "config", "installed-res.json"),
			JSON.stringify({ resourceUrl: baseUrl }),
		);

		const output = await runCli(["status", "--workspace", root]);
		const parsed = JSON.parse(output) as { data?: StatusEntry[] };
		const entries = parsed.data ?? [];
		const byRef = new Map(entries.map((entry) => [entry.moduleRef, entry]));

		assert.equal(byRef.get("svc")?.result?.status, "SUCCEEDED");
		assert.equal(byRef.get("res")?.result?.status, "SUCCEEDED");
		assert.equal(byRef.get("installed-res")?.result?.status, "SUCCEEDED");
		assert.equal(byRef.get("plain")?.result?.status, "ACTION_REQUIRED");
	} finally {
		await new Promise<void>((resolve) => server?.close(() => resolve()));
		await rm(root, { recursive: true, force: true });
	}
});

test("all shipped service/external-resource modules expose a production binding factory", async () => {
	const root = fileURLToPath(new URL("../../../", import.meta.url));
	const modules = await discoverModules({ workspaceRoot: root });
	const governed = modules.filter(
		(module) =>
			module.kind === "service" || module.kind === "external-resource",
	);
	assert.ok(governed.length > 0);
	const missing: string[] = [];
	for (const module of governed) {
		const namespace = await importRawAdapter(
			module.packageName,
			module.source,
			root,
		);
		if (typeof namespace.createProductionBinding !== "function") {
			missing.push(`${module.moduleRef}:${module.packageName}`);
		}
	}
	assert.deepEqual(missing, []);
});

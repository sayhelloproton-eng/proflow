import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import { runCli } from "../src/cli.ts";
import { tempWorkspace, writeInstalledModule } from "./test-helpers.ts";

const MODULE = {
	moduleRef: "fixture-service",
	packageName: "@tomflow/proflow-fixture-service",
	version: "1.0.0",
} as const;

const adapterSource = `
let running = false;
let ready = false;
const result = (data) => ({
  contract: "deployment.result.v1",
  ok: true,
  status: "SUCCEEDED",
  moduleRef: "fixture-service",
  moduleVersion: "1.0.0",
  ...(data === undefined ? {} : { data }),
});
export const behaviorAdapter = {
  install: async () => ({ result: result(), observedEffects: [] }),
  uninstall: async () => ({ result: result(), observedEffects: [] }),
  status: async () => ({ result: result({ setupStatus: ready ? "READY" : "ACTION_REQUIRED", runtimeStatus: running ? "RUNNING" : "STOPPED" }), observedEffects: [] }),
  setup: async () => { ready = true; return { result: result(), observedEffects: [] }; },
  docs: async () => ({ result: result({ docs: "Fixture Service", setup: "No configuration required." }), observedEffects: [] }),
  start: async () => { running = true; return { result: result(), observedEffects: [] }; },
  stop: async () => { running = false; return { result: result(), observedEffects: [] }; },
};
`;
function registryRunner() {
	return {
		async run(args: readonly string[]) {
			if (args[0] === "config") {
				return { stdout: "https://registry.example.test\n", stderr: "" };
			}
			if (args[0] === "search") {
				return {
					stdout: JSON.stringify([{ name: MODULE.packageName }]),
					stderr: "",
				};
			}
			if (args[0] === "view") {
				return {
					stdout: JSON.stringify({
						name: MODULE.packageName,
						version: MODULE.version,
						proflow: {
							module: true,
							descriptor: "./deployment/descriptor.js",
							manifest: "./proflow.module.json",
						},
					}),
					stderr: "",
				};
			}
			throw new Error(`unexpected registry args: ${args.join(" ")}`);
		},
	};
}
async function manifest(root: string): Promise<Record<string, unknown>> {
	return JSON.parse(
		await readFile(join(root, "package.json"), "utf8"),
	) as Record<string, unknown>;
}

function packageRunner(root: string, calls: string[][]) {
	return {
		async run(command: string, args: readonly string[]) {
			calls.push([command, ...args]);
			if (args.includes("install")) {
				await writeFile(
					join(root, "package.json"),
					JSON.stringify({
						...(await manifest(root)),
						dependencies: { [MODULE.packageName]: MODULE.version },
					}),
				);
				await writeInstalledModule(root, {
					...MODULE,
					kind: "service",
					adapterSource,
				});
				return "";
			}
			if (args.includes("uninstall")) {
				await writeFile(
					join(root, "package.json"),
					JSON.stringify({ ...(await manifest(root)), dependencies: {} }),
				);
				return "";
			}
			throw new Error(
				`unexpected package-manager call: ${command} ${args.join(" ")}`,
			);
		},
	};
}

function parse(output: string) {
	return JSON.parse(output) as {
		status: string;
		data?: { modules?: Array<Record<string, unknown>> } & Record<
			string,
			unknown
		>;
	};
}

test("simulated human Golden Path runs install → status → setup → docs → start → status → stop → uninstall", async () => {
	const root = await tempWorkspace();
	const calls: string[][] = [];
	const runtime = {
		cwd: root,
		registryRunner: registryRunner(),
		packageRunner: packageRunner(root, calls),
		executableAvailable: () => true,
	};
	try {
		const installed = parse(
			await runCli(["install", "--workspace", ".", "--json"], runtime),
		);
		assert.equal(installed.status, "SUCCEEDED");

		const before = parse(
			await runCli(["status", "--workspace", ".", "--json"], { cwd: root }),
		);
		assert.equal(before.status, "SUCCEEDED");
		assert.equal(before.data?.modules?.[0]?.setupStatus, "ACTION_REQUIRED");
		assert.equal(before.data?.modules?.[0]?.runtimeStatus, "STOPPED");

		const setup = parse(
			await runCli(["setup", "--workspace", ".", "--json"], { cwd: root }),
		);
		assert.equal(setup.status, "SUCCEEDED");
		const ready = parse(
			await runCli(["status", "--workspace", ".", "--json"], { cwd: root }),
		);
		assert.equal(ready.data?.modules?.[0]?.setupStatus, "READY");

		const docs = parse(
			await runCli(["docs", "--workspace", ".", "--json"], { cwd: root }),
		);
		assert.equal(docs.status, "SUCCEEDED");
		assert.match(
			JSON.stringify(docs.data?.modules?.[0]?.docs ?? {}),
			/Fixture Service/,
		);

		const started = parse(
			await runCli(["start", "--workspace", ".", "--json"], { cwd: root }),
		);
		assert.equal(started.status, "SUCCEEDED");
		const running = parse(
			await runCli(["status", "--workspace", ".", "--json"], { cwd: root }),
		);
		assert.equal(running.data?.modules?.[0]?.runtimeStatus, "RUNNING");

		const stopped = parse(
			await runCli(["stop", "--workspace", ".", "--json"], { cwd: root }),
		);
		assert.equal(stopped.status, "SUCCEEDED");
		const afterStop = parse(
			await runCli(["status", "--workspace", ".", "--json"], { cwd: root }),
		);
		assert.equal(afterStop.data?.modules?.[0]?.runtimeStatus, "STOPPED");

		const uninstalled = parse(
			await runCli(["uninstall", "--workspace", ".", "--json"], {
				cwd: root,
				packageRunner: runtime.packageRunner,
				executableAvailable: () => true,
			}),
		);
		assert.equal(uninstalled.status, "SUCCEEDED");
		assert.deepEqual((await manifest(root)).dependencies, {});
		assert.match(
			await readFile(join(root, ".proflow", "workspace.json"), "utf8"),
			/proflow\.workspace\.v1/,
		);
		assert.equal(calls.filter((call) => call.includes("install")).length, 1);
		assert.equal(calls.filter((call) => call.includes("uninstall")).length, 1);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

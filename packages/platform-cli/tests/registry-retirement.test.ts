import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
	discoverRegistryModules,
	type NpmCommandRunner,
} from "../src/registry/npm-registry.ts";

test("retired packages returned by npm search are ignored without being viewed", async () => {
	const manifest = JSON.parse(
		await readFile(new URL("../package.json", import.meta.url), "utf8"),
	);
	const calls: string[][] = [];
	const runner: NpmCommandRunner = {
		async run(args) {
			calls.push([...args]);
			if (args[0] === "config")
				return { stdout: "https://registry.npmjs.org/\n", stderr: "" };
			if (args[0] === "search")
				return {
					stdout: JSON.stringify([
						{ name: "@tomflow/proflow-chatgpt-carrier" },
						{ name: "@tomflow/proflow-devtunnel-cli" },
						{ name: "@tomflow/proflow-platform-cli" },
					]),
					stderr: "",
				};
			return { stdout: JSON.stringify(manifest), stderr: "" };
		},
	};
	const result = await discoverRegistryModules({
		workspaceRoot: process.cwd(),
		runner,
	});
	assert.deepEqual(result.retired, [
		"@tomflow/proflow-chatgpt-carrier",
		"@tomflow/proflow-devtunnel-cli",
	]);
	assert.deepEqual(
		result.candidates.map((item) => item.packageName),
		["@tomflow/proflow-platform-cli"],
	);
	assert.equal(
		calls.some(
			(args) =>
				args[0] === "view" && args[1] === "@tomflow/proflow-chatgpt-carrier",
		),
		false,
	);
	assert.equal(
		calls.some(
			(args) =>
				args[0] === "view" && args[1] === "@tomflow/proflow-devtunnel-cli",
		),
		false,
	);
});

test("registry manifest checks use a bounded eight-worker pool", async () => {
	const names = Array.from(
		{ length: 12 },
		(_, index) => `@tomflow/proflow-fixture-${String(index).padStart(2, "0")}`,
	);
	let active = 0;
	let maxActive = 0;
	const runner: NpmCommandRunner = {
		async run(args) {
			if (args[0] === "config")
				return { stdout: "https://registry.npmjs.org/\n", stderr: "" };
			if (args[0] === "search")
				return {
					stdout: JSON.stringify(names.map((name) => ({ name }))),
					stderr: "",
				};
			if (args[0] === "view") {
				active += 1;
				maxActive = Math.max(maxActive, active);
				await new Promise((resolveWait) => setTimeout(resolveWait, 20));
				active -= 1;
				return {
					stdout: JSON.stringify({
						name: args[1],
						version: "1.0.0",
						proflow: {
							module: true,
							descriptor: "./dist/deployment/descriptor.js",
							manifest: "./proflow.module.json",
						},
					}),
					stderr: "",
				};
			}
			throw new Error(`unexpected npm command: ${args.join(" ")}`);
		},
	};
	const result = await discoverRegistryModules({
		workspaceRoot: process.cwd(),
		runner,
	});
	assert.equal(result.candidates.length, names.length);
	assert.equal(maxActive, 8);
});

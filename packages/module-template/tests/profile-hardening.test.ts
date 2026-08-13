import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { ModuleKind } from "@tomflow/proflow-module-contract";
import {
	loadGeneratedBehaviorAdapter,
	materializeModule,
} from "../src/index.ts";

const kinds: ModuleKind[] = [
	"library",
	"service",
	"cli",
	"browser-extension",
	"agent-package",
	"external-resource",
];

test("P1-1/P1-2 all six profiles load and execute their own generated adapter", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "proflow-own-adapter-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	for (const kind of kinds) {
		const generated = await materializeModule({
			targetDirectory: root,
			moduleRef: `own-adapter-${kind}`,
			packageName: `@tomflow/proflow-own-adapter-${kind}`,
			kind,
		});
		const adapter = await loadGeneratedBehaviorAdapter(
			generated.packageDirectory,
		);
		for (const primitive of generated.descriptor.lifecycle.supported) {
			assert.equal(
				typeof adapter[primitive],
				"function",
				`${kind}:${primitive}`,
			);
			const observation = await adapter[primitive]?.();
			assert.equal(observation?.result.contract, "deployment.result.v1");
		}
		if (kind === "service") assert.equal(typeof adapter.restart, "function");
		const verification = await adapter.verify?.();
		assert.equal(
			verification?.result.checks?.some(
				(check) => check.id === "generated-adapter" && check.status === "PASS",
			),
			false,
		);
		if (kind === "cli") assert.equal(generated.machineEntry, "src/cli.ts");
		if (kind === "agent-package") {
			const status = await adapter.status?.();
			assert.equal(status?.result.status, "ACTION_REQUIRED");
		}
		if (kind === "external-resource") {
			const status = await adapter.status?.();
			assert.equal(status?.externalAvailabilityClaim, "UNKNOWN");
		}
	}
});

test("P1-4/P1-5 template enforces formal names and creates publishable public packages", async (context) => {
	const root = await mkdtemp(join(tmpdir(), "proflow-publishable-"));
	context.after(() => rm(root, { recursive: true, force: true }));
	await assert.rejects(
		materializeModule({
			targetDirectory: root,
			moduleRef: "invalid-name",
			packageName: "@tomflow/invalid-name",
			kind: "library",
		}),
	);
	const generated = await materializeModule({
		targetDirectory: root,
		moduleRef: "publishable",
		packageName: "@tomflow/proflow-publishable",
		kind: "library",
	});
	assert.equal(generated.packageMetadata.private, undefined);
	assert.deepEqual(generated.packageMetadata.publishConfig, {
		access: "public",
	});
});

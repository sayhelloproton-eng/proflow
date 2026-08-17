import assert from "node:assert/strict";
import { test } from "node:test";

import {
	assessModuleCompatibility,
	type ModuleDescriptor,
	moduleDescriptorSchema,
	parseModuleDescriptor,
	queryRequirements,
} from "../src/index.ts";

const libraryDescriptor = {
	contract: "module",
	contractVersion: "1.0.0",
	moduleRef: "example-library",
	packageName: "@tomflow/proflow-example-library",
	moduleVersion: "1.0.0",
	kind: "library",
	installClass: "optional",
	identity: {
		domain: "deployment-governance",
		summary: "Module contract test fixture",
	},
	templateVersion: "1.0.0",
	platformCompatibility: ">=1.0.0 <2.0.0",
	provides: [{ contractRef: "example.contract", version: "1.0.0" }],
	requires: [],
	requirements: [
		{ kind: "runtime", runtime: "node", versionRange: ">=24.19.0" },
	],
	configSlots: [],
	lifecycle: { supported: ["describe", "preflight", "verify", "doctor"] },
	verification: {
		checks: [
			{
				id: "module-loads",
				description: "The module entry can be loaded",
				lifecycle: "verify",
			},
		],
	},
	effects: [],
	documentation: [],
} as const satisfies ModuleDescriptor;

test("CP-DPL-CON-01 parses a complete descriptor and rejects an incomplete boundary", () => {
	const parsed = parseModuleDescriptor(libraryDescriptor);
	assert.equal(parsed.moduleRef, "example-library");
	assert.equal(
		moduleDescriptorSchema.safeParse({
			...libraryDescriptor,
			verification: undefined,
		}).success,
		false,
	);
	assert.equal(
		moduleDescriptorSchema.safeParse({
			...libraryDescriptor,
			configSlots: [
				{
					key: "providerModuleRef",
					type: "moduleRef",
					required: true,
					description: "Must be a managed Module reference",
					default: "https://provider.example.com",
				},
			],
		}).success,
		false,
	);
	assert.equal(
		moduleDescriptorSchema.safeParse({
			...libraryDescriptor,
			kind: "external-resource",
			resourceVersion: "observed-version-must-not-live-in-descriptor",
		}).success,
		false,
	);
});

test("CP-DPL-CON-02 distinguishes moduleRef and secretRef and rejects unsafe combinations", () => {
	const valid = parseModuleDescriptor({
		...libraryDescriptor,
		configSlots: [
			{
				key: "providerModuleRef",
				type: "moduleRef",
				required: true,
				description: "Managed provider module",
			},
			{
				key: "providerSecret",
				type: "secretRef",
				required: true,
				description: "Secret manager reference",
				sensitive: true,
			},
		],
	});
	assert.equal(valid.configSlots.length, 2);
	assert.equal(
		moduleDescriptorSchema.safeParse({
			...libraryDescriptor,
			configSlots: [
				{
					key: "providerSecret",
					type: "secretRef",
					required: true,
					description: "Unsafe inline secret",
					sensitive: false,
					default: "plaintext",
				},
			],
		}).success,
		false,
	);
});

test("CP-DPL-CON-03 requirement queries are deterministic and side-effect free", () => {
	const descriptor = parseModuleDescriptor(libraryDescriptor);
	const before = structuredClone(descriptor);
	const first = queryRequirements(descriptor);
	const second = queryRequirements(descriptor);
	assert.deepEqual(first, second);
	assert.deepEqual(descriptor, before);
	assert.notEqual(first, descriptor.requirements);
});

test("CP-DPL-CON-04 libraries and uncontrollable external resources do not fake start/stop", () => {
	assert.equal(
		moduleDescriptorSchema.safeParse({
			...libraryDescriptor,
			lifecycle: { supported: ["describe", "start", "stop"] },
		}).success,
		false,
	);
	const external = parseModuleDescriptor({
		...libraryDescriptor,
		moduleRef: "external-provider",
		packageName: "@tomflow/proflow-external-provider",
		kind: "external-resource",
		lifecycle: {
			supported: ["describe", "preflight", "status", "verify", "doctor"],
		},
	});
	assert.equal(external.lifecycle.supported.includes("start"), false);
});

test("CP-DPL-CON-05 compatibility distinguishes additive and breaking changes", () => {
	const current = parseModuleDescriptor(libraryDescriptor);
	const additive = parseModuleDescriptor({
		...libraryDescriptor,
		moduleVersion: "1.1.0",
		provides: [
			...libraryDescriptor.provides,
			{ contractRef: "extra.contract", version: "1.0.0" },
		],
	});
	const breaking = parseModuleDescriptor({
		...libraryDescriptor,
		moduleVersion: "2.0.0",
		provides: [],
	});
	assert.deepEqual(assessModuleCompatibility(current, additive), {
		compatible: true,
		breakingChanges: [],
	});
	assert.equal(assessModuleCompatibility(current, breaking).compatible, false);
});

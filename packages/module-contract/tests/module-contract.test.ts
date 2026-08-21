import assert from "node:assert/strict";
import { test } from "node:test";

import {
	assessModuleCompatibility,
	type ModuleDescriptor,
	moduleDescriptorSchema,
	moduleDocsDataSchema,
	moduleOperationResultSchema,
	moduleSetupPlanDataSchema,
	parseModuleDescriptor,
	queryRequirements,
	standardModuleManagementCommands,
} from "../src/index.ts";

const libraryDescriptor = {
	contract: "module",
	contractVersion: "1.0.0",
	moduleRef: "example-library",
	packageName: "@tomflow/proflow-example-library",
	moduleVersion: "1.0.0",
	kind: "library",
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
	effects: [],
	documentation: { docs: "DOCS.md", setup: "SETUP.md" },
} as const satisfies ModuleDescriptor;

test("docs and setup plan boundaries require executable structured content", () => {
	assert.equal(
		moduleDocsDataSchema.safeParse({ docs: "# Capability\n" }).success,
		true,
	);
	assert.equal(
		moduleDocsDataSchema.safeParse({ docs: "DOCS.md", setup: "SETUP.md" })
			.success,
		false,
	);
	const step = {
		id: "STEP-EXAMPLE-01",
		title: "配置",
		state: "TODO",
		responsible: "USER",
		execution: {
			interactive: "proflow-example setup",
			nonInteractive: "proflow-example setup --value <value>",
		},
		requiredInputs: [
			{ name: "value", description: "配置值", sensitive: false },
		],
		verify: "proflow-example verify",
		successCondition: "setupStatus=READY",
	};
	assert.equal(
		moduleSetupPlanDataSchema.safeParse({ steps: [step] }).success,
		true,
	);
	assert.equal(
		moduleSetupPlanDataSchema.safeParse({
			steps: [{ ...step, state: "BLOCKED" }],
		}).success,
		false,
	);
});

test("CP-DPL-CON-01 parses a complete descriptor and rejects an incomplete boundary", () => {
	const parsed = parseModuleDescriptor(libraryDescriptor);
	assert.equal(parsed.moduleRef, "example-library");
	assert.equal(
		moduleDescriptorSchema.safeParse({
			...libraryDescriptor,
			documentation: undefined,
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

test("CP-DPL-CON-04 standard management is fixed at seven commands and legacy lifecycle fields are rejected", () => {
	assert.deepEqual(standardModuleManagementCommands, [
		"install",
		"uninstall",
		"status",
		"setup",
		"docs",
		"start",
		"stop",
	]);
	assert.equal(
		moduleDescriptorSchema.safeParse({
			...libraryDescriptor,
			lifecycle: { supported: ["start", "stop"] },
		}).success,
		false,
	);
	const external = parseModuleDescriptor({
		...libraryDescriptor,
		moduleRef: "external-provider",
		packageName: "@tomflow/proflow-external-provider",
		kind: "external-resource",
	});
	assert.deepEqual(external.documentation, {
		docs: "DOCS.md",
		setup: "SETUP.md",
	});
});

test("CP-DPL-CON-04 Module results reject Platform-only BLOCKED outcomes", () => {
	assert.equal(
		moduleOperationResultSchema.safeParse({
			contract: "deployment.result.v1",
			ok: false,
			status: "BLOCKED",
			moduleRef: "example-library",
			moduleVersion: "1.0.0",
		}).success,
		false,
	);
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

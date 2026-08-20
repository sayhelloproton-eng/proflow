import assert from "node:assert/strict";
import { test } from "node:test";

import {
	assessModuleCompatibility,
	type ModuleDescriptor,
	parseModuleDescriptor,
} from "../src/index.ts";

function descriptor(
	overrides: Partial<ModuleDescriptor> = {},
): ModuleDescriptor {
	return parseModuleDescriptor({
		contract: "module",
		contractVersion: "1.0.0",
		moduleRef: "compatibility-fixture",
		packageName: "@tomflow/proflow-compatibility-fixture",
		moduleVersion: "1.0.0",
		kind: "service",
		identity: {
			domain: "deployment-governance",
			summary: "Compatibility hardening fixture",
		},
		templateVersion: "1.0.0",
		platformCompatibility: ">=1.0.0 <2.0.0",
		provides: [{ contractRef: "fixture.public", version: "1.0.0" }],
		requires: [
			{ contractRef: "provider.public", versionRange: ">=1.0.0 <2.0.0" },
		],
		requirements: [
			{ kind: "runtime", runtime: "node", versionRange: ">=24.19.0" },
		],
		configSlots: [],
		effects: [
			{
				kind: "network",
				description: "Call the declared provider",
				retention: "preserve",
			},
		],
		documentation: { docs: "DOCS.md", setup: "SETUP.md" },
		...overrides,
	});
}

test("P1-6 compatibility covers all mechanically decidable breaking dimensions", () => {
	const current = descriptor();
	const breakingTargets: ModuleDescriptor[] = [
		descriptor({ provides: [] }),
		descriptor({
			provides: [{ contractRef: "fixture.public", version: "2.0.0" }],
		}),
		descriptor({
			requires: [
				{ contractRef: "provider.public", versionRange: ">=2.0.0 <3.0.0" },
			],
		}),
		descriptor({
			configSlots: [
				{
					key: "requiredValue",
					type: "string",
					required: true,
					description: "Required value",
				},
			],
		}),
		descriptor({ effects: [] }),
		descriptor({ platformCompatibility: ">=1.5.0 <2.0.0" }),
	];
	for (const target of breakingTargets) {
		assert.equal(assessModuleCompatibility(current, target).compatible, false);
	}
	assert.equal(
		assessModuleCompatibility(
			current,
			descriptor({
				moduleVersion: "1.1.0",
				provides: [
					{ contractRef: "fixture.public", version: "1.1.0" },
					{ contractRef: "fixture.extra", version: "1.0.0" },
				],
			}),
		).compatible,
		true,
	);
	assert.equal(
		assessModuleCompatibility(current, descriptor({ templateVersion: "2.0.0" }))
			.compatible,
		true,
		"a new template alone does not force migration while conformance remains compatible",
	);
});

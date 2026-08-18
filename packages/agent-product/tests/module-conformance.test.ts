import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
	runBehaviorConformance,
	runPackageConformance,
	runStaticConformance,
} from "@tomflow/proflow-deployment-conformance";
import type { ModuleDescriptor } from "@tomflow/proflow-module-contract";
import {
	behaviorAdapter,
	createProductionBinding,
} from "../deployment/adapter.ts";
import { descriptor } from "../deployment/descriptor.ts";

test("module contract C1/C2/C3", async () => {
	const packageRoot = fileURLToPath(new URL("..", import.meta.url));
	const contract = descriptor as unknown as ModuleDescriptor;
	assert.equal(runStaticConformance(descriptor).status, "PASS");
	assert.equal(
		(await runPackageConformance(packageRoot, contract)).status,
		"PASS",
	);
	assert.equal(
		(await runBehaviorConformance(contract, behaviorAdapter)).status,
		"PASS",
	);
});

test("production binding observes durable Role registration reality", async () => {
	const stateRoot = await mkdtemp(join(tmpdir(), "proflow-role-binding-"));
	try {
		const binding = createProductionBinding({
			configByModuleRef: new Map([["platform-host", { stateRoot }]]),
		});
		assert.ok(binding);
		const adapter = binding.behaviorAdapter as unknown as {
			preflight(): {
				result: {
					status: string;
					actionRequired?: { description: string };
				};
			};
		};
		const missing = adapter.preflight().result;
		assert.equal(missing.status, "ACTION_REQUIRED");
		assert.match(
			missing.actionRequired?.description ?? "",
			new RegExp(descriptor.packageName),
		);

		const roleRef = `g-${descriptor.moduleRef}-real1`;
		const agentRoot = join(stateRoot, "agent");
		await mkdir(join(agentRoot, "secrets"), { recursive: true });
		await writeFile(
			join(agentRoot, "roles.json"),
			`${JSON.stringify([{ agentPackageRef: descriptor.packageName, registeredPackageVersion: descriptor.moduleVersion, roleRef, carrierType: "custom-gpt", carrierUrl: `https://chatgpt.com/g/${roleRef}`, registeredAt: "2026-08-19T00:00:00.000Z" }], null, 2)}\n`,
		);
		await writeFile(
			join(agentRoot, "secrets", "role-credentials.json"),
			`${JSON.stringify({ [roleRef]: "credential-role-binding-0123456789abcdef" }, null, 2)}\n`,
		);
		assert.equal(adapter.preflight().result.status, "SUCCEEDED");
	} finally {
		await rm(stateRoot, { recursive: true, force: true });
	}
});

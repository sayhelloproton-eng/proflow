import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { inspectDurableRoleRegistration } from "../src/index.ts";

const packageRef = "@tomflow/proflow-agent-product";
const expectedVersion = "0.1.4";
const roleRef = "g-product-real1";

function inspect(stateRoot: string) {
	return inspectDurableRoleRegistration({
		proflowRoot: stateRoot,
		agentPackageRef: packageRef,
		expectedPackageVersion: expectedVersion,
	});
}

function role(version = expectedVersion) {
	return {
		agentPackageRef: packageRef,
		registeredPackageVersion: version,
		roleRef,
		carrierType: "custom-gpt",
		carrierUrl: `https://chatgpt.com/g/${roleRef}`,
		registeredAt: "2026-08-19T00:00:00.000Z",
	};
}
test("durable Role reality distinguishes missing, ready, drift, and half-state", async () => {
	const stateRoot = await mkdtemp(join(tmpdir(), "proflow-role-reality-"));
	try {
		assert.equal(inspect(stateRoot).status, "MISSING");
		const agentRoot = join(stateRoot, "agent");
		await mkdir(join(agentRoot, "secrets"), { recursive: true });
		await writeFile(
			join(agentRoot, "roles.json"),
			`${JSON.stringify([role()], null, 2)}\n`,
		);
		await writeFile(
			join(agentRoot, "secrets", "role-credentials.json"),
			`${JSON.stringify({ [roleRef]: "credential-product-real1-0123456789abcdef" }, null, 2)}\n`,
		);
		assert.equal(inspect(stateRoot).status, "READY");

		await writeFile(
			join(agentRoot, "roles.json"),
			`${JSON.stringify([role("0.0.1")], null, 2)}\n`,
		);
		assert.equal(inspect(stateRoot).status, "DRIFT");

		await writeFile(
			join(agentRoot, "roles.json"),
			`${JSON.stringify([role()], null, 2)}\n`,
		);
		await writeFile(
			join(agentRoot, "secrets", "role-credentials.json"),
			"{}\n",
		);
		assert.equal(inspect(stateRoot).status, "BROKEN");
	} finally {
		await rm(stateRoot, { recursive: true, force: true });
	}
});

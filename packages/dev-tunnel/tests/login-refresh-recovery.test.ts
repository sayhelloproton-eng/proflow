import assert from "node:assert/strict";
import { test } from "node:test";

import { createDevTunnelAutomation } from "../src/resource-adapter.ts";

const result = (stdout: string, exitCode: number | null = 0, stderr = "") => ({
	exitCode,
	stdout,
	stderr,
});

test("CP-DEV-TUNNEL-01 CLI refresh failure uses bounded verbose evidence before one browser re-auth", async () => {
	const calls: string[][] = [];
	const timeouts: Array<number | undefined> = [];
	const automation = createDevTunnelAutomation({
		runCommand: async (_command, args, options) => {
			calls.push(args);
			timeouts.push(options?.timeoutMs);
			if (calls.length === 1)
				return result("", 1, "GitHub token refresh failed.");
			if (calls.length === 2)
				return result(
					"Loaded cached GitHub tokens for account(s): test\nThe cached access token for GitHub account 'test' expired at 2026-09-11T15:05:43",
					1,
					"GitHub token refresh failed.",
				);
			if (calls.length === 3) return result("");
			return result(JSON.stringify({ status: "Logged in as test" }));
		},
	});
	assert.equal(await automation.ensureLogin(), "LOGGED_IN");
	assert.deepEqual(calls, [
		["user", "show", "--json"],
		["-v", "user", "show", "--json"],
		["user", "login", "--github", "--use-browser-auth"],
		["user", "show", "--json"],
	]);
	assert.deepEqual(timeouts, [90_000, 8_000, 600_000, 90_000]);
});

test("CP-DEV-TUNNEL-01 generic CLI errors remain fail-closed after bounded verbose diagnosis", async () => {
	const calls: string[][] = [];
	const automation = createDevTunnelAutomation({
		runCommand: async (_command, args) => {
			calls.push(args);
			return result("", 1, "service unavailable");
		},
	});
	await assert.rejects(
		() => automation.ensureLogin(),
		/Dev Tunnel login status is CLI_ERROR/,
	);
	assert.deepEqual(calls, [
		["user", "show", "--json"],
		["-v", "user", "show", "--json"],
	]);
});

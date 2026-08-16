import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type RequestListener } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const managementCredential = "role-management-test-credential-0123456789";
const roleCredential = "role-package-test-credential-0123456789";

type SeenRequest = {
	operation: string;
	input: Record<string, unknown>;
	authorization: string | undefined;
};

async function listen(
	handler: RequestListener,
): Promise<{ baseUrl: string; close(): Promise<void> }> {
	const server = createServer(handler);
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => resolve());
	});
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("LISTEN_FAILED");
	return {
		baseUrl: `http://127.0.0.1:${address.port}`,
		close: () =>
			new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			),
	};
}

async function runCli(
	cliUrl: URL,
	args: string[],
): Promise<Record<string, unknown>> {
	const { stdout, stderr } = await execFileAsync(
		process.execPath,
		[cliUrl.pathname, ...args],
		{ encoding: "utf8" },
	);
	assert.equal(stderr, "");
	return JSON.parse(stdout) as Record<string, unknown>;
}

const roles = [
	{
		packageName: "@tomflow/proflow-agent-product",
		cli: new URL("../../agent-product/dist/src/cli.js", import.meta.url),
	},
	{
		packageName: "@tomflow/proflow-agent-controller-dev",
		cli: new URL("../../agent-controller-dev/dist/src/cli.js", import.meta.url),
	},
	{
		packageName: "@tomflow/proflow-agent-test-ops",
		cli: new URL("../../agent-test-ops/dist/src/cli.js", import.meta.url),
	},
] as const;

test("PRESMOKE-B6-ROLE-CLI real subprocesses route the full frozen role/key surface through authenticated Agent owner HTTP", async () => {
	const root = await mkdtemp(join(tmpdir(), "proflow-role-cli-"));
	const seen: SeenRequest[] = [];
	const management = await listen(async (request, response) => {
		if (request.method !== "POST" || request.url !== "/management/agent") {
			response.writeHead(404).end();
			return;
		}
		let body = "";
		for await (const chunk of request) body += String(chunk);
		const parsed = JSON.parse(body) as {
			operation: string;
			input?: Record<string, unknown>;
		};
		seen.push({
			operation: parsed.operation,
			input: parsed.input ?? {},
			authorization: request.headers.authorization,
		});
		const result =
			parsed.operation === "role.validate"
				? { status: "PASS", role: { roleRef: "g-proof" }, issues: [] }
				: parsed.operation === "role.key.show"
					? { roleRef: "g-proof", credential: roleCredential }
					: parsed.operation === "role.list"
						? []
						: { ok: true, operation: parsed.operation };
		response.writeHead(200, { "content-type": "application/json" });
		response.end(JSON.stringify(result));
	});
	const gateway = await listen((request, response) => {
		if (request.url === "/health") {
			response.writeHead(200, { "content-type": "application/json" });
			response.end('{"status":"UP"}');
			return;
		}
		if (request.url?.startsWith("/actions/getTask")) {
			assert.equal(request.headers.authorization, `Bearer ${roleCredential}`);
			response.writeHead(400, { "content-type": "application/json" });
			response.end('{"error":"probe task intentionally absent"}');
			return;
		}
		response.writeHead(404).end();
	});

	try {
		const tokenPath = join(root, "agent", "secrets", "role-management.token");
		await mkdir(dirname(tokenPath), { recursive: true });
		await writeFile(tokenPath, `${managementCredential}\n`, { mode: 0o600 });
		for (const role of roles) {
			const common = [
				"--platform-host-url",
				management.baseUrl,
				"--state-root",
				root,
			];
			const before = seen.length;
			await runCli(role.cli, [
				"role",
				"register",
				"https://chatgpt.com/g/g-proof",
				...common,
			]);
			await runCli(role.cli, ["role", "show", ...common]);
			await runCli(role.cli, ["role", "list", ...common]);
			const validated = await runCli(role.cli, [
				"role",
				"validate",
				...common,
				"--gateway-url",
				gateway.baseUrl,
			]);
			assert.equal(validated.status, "PASS");
			await runCli(role.cli, ["role", "delete", ...common]);
			await runCli(role.cli, ["role", "key", "show", ...common]);
			await runCli(role.cli, ["role", "key", "rotate", ...common]);

			const calls = seen.slice(before);
			assert.deepEqual(
				calls.map((call) => call.operation),
				[
					"role.register",
					"role.show",
					"role.list",
					"role.validate",
					"role.key.show",
					"role.delete",
					"role.key.show",
					"role.key.rotate",
				],
			);
			for (const call of calls)
				assert.equal(call.authorization, `Bearer ${managementCredential}`);
			assert.equal(calls[0]?.input.agentPackageRef, role.packageName);
			assert.equal(calls[1]?.input.agentPackageRef, role.packageName);
			assert.equal(calls[3]?.input.agentPackageRef, role.packageName);
			assert.equal(calls[5]?.input.agentPackageRef, role.packageName);
			assert.equal(calls[6]?.input.agentPackageRef, role.packageName);
			assert.equal(calls[7]?.input.agentPackageRef, role.packageName);
		}
	} finally {
		await gateway.close();
		await management.close();
		await rm(root, { recursive: true, force: true });
	}
});

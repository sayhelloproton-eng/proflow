import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

function run(args: string[]) {
	return new Promise<{ code: number | null; stderr: string }>((resolve) => {
		const child = spawn(process.execPath, args, {
			stdio: ["ignore", "ignore", "pipe"],
		});
		let stderr = "";
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("close", (code) => resolve({ code, stderr }));
	});
}

test("RF-EXE-RT-11 formal execution CLI rejects group/world-readable transport credentials", async (t) => {
	if (process.platform === "win32") return t.skip("POSIX mode proof");
	const root = await mkdtemp(join(tmpdir(), "proflow-execution-cli-security-"));
	const identity = join(root, "identity.token");
	const transport = join(root, "execution.token");
	const model = join(root, "model.token");
	await writeFile(
		identity,
		"identity-credential-value-abcdefghijklmnopqrstuvwxyz\n",
		{ mode: 0o600 },
	);
	await writeFile(
		transport,
		"execution-credential-value-abcdefghijklmnopqrstuvwxyz\n",
		{ mode: 0o600 },
	);
	await writeFile(
		model,
		"model-credential-value-abcdefghijklmnopqrstuvwxyz\n",
		{ mode: 0o600 },
	);
	await chmod(transport, 0o644);
	const config = join(root, "config.json");
	await writeFile(
		config,
		JSON.stringify({
			databasePath: join(root, "execution.sqlite"),
			projectRoot: root,
			artifactRoot: join(root, "artifacts"),
			host: "127.0.0.1",
			port: 0,
			exactNetworkTargets: [],
			browserExecutorConfigPath: join(root, "browser.json"),
			transportCredentialFile: transport,
			identity: { endpoint: "http://127.0.0.1:9", tokenFile: identity },
			modelDecision: { endpoint: "http://127.0.0.1:9", credentialFile: model },
		}),
	);
	const cli = new URL("../src/cli.ts", import.meta.url);
	const result = await run([cli.pathname, "start", config]);
	assert.notEqual(result.code, 0);
	assert.match(
		result.stderr,
		/execution transport credential permissions must be owner-only/,
	);
});

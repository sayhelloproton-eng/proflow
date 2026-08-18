import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("published deployment adapter resolves the package root outside dist", async () => {
	const workspaceRoot = await mkdtemp(
		join(tmpdir(), "proflow-browser-packaged-"),
	);
	const tokenFile = join(workspaceRoot, "token.txt");
	await writeFile(tokenFile, "x".repeat(40), "utf8");
	try {
		const packagedAdapter = (await import(
			"../dist/deployment/adapter.js"
		)) as typeof import("../deployment/adapter.ts");
		const result = await packagedAdapter.materializeProductionConfig({
			moduleRef: "execution-browser-extension",
			workspaceRoot,
			config: {
				"bridge.endpoint": "http://127.0.0.1:43100/",
				"bridge.token": tokenFile,
				"taskApplication.endpoint": "http://127.0.0.1:43100/",
				"taskApplication.token": tokenFile,
				"approvalApplication.endpoint": "http://127.0.0.1:43100/",
				"approvalApplication.token": tokenFile,
			},
		});
		await access(join(result.loadDir, "manifest.json"));
		await access(join(result.loadDir, "dist", "extension", "background.js"));
		const runtime = JSON.parse(
			await readFile(join(result.loadDir, "runtime-config.json"), "utf8"),
		) as { proflowTaskApplication?: { endpoint?: string } };
		assert.equal(
			runtime.proflowTaskApplication?.endpoint,
			"http://127.0.0.1:43100",
		);
	} finally {
		await rm(workspaceRoot, { recursive: true, force: true });
	}
});

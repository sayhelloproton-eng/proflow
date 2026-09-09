import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
	createDirectToolExecutor,
	DirectToolError,
} from "../src/direct-tools.ts";

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "proflow-direct-tools-"));
	await writeFile(
		join(root, "package.json"),
		JSON.stringify({ name: "fixture" }, null, 2),
	);
	await writeFile(
		join(root, "source.ts"),
		"export const DirectToolSymbol = 1;\n",
	);
	const executor = await createDirectToolExecutor({
		workspaceRoot: root,
		generation: "generation-test",
	});
	return { root, executor };
}

function request(
	tool: "localDev" | "repomix" | "codeGraph",
	operation: string,
	input: unknown,
) {
	return {
		authenticatedRoleRef: "g-dev",
		tool,
		operation,
		input,
		deadlineAt: new Date(Date.now() + 40_000).toISOString(),
	} as const;
}

test("CP-EXE-LOCAL-DIRECT-01 / CP-EXE-LOCAL-14 / CP-EXE-LOCAL-15 Local Dev search stays narrow and Direct Tool results use no Execution DTOs", async (context) => {
	const { root, executor } = await fixture();
	context.after(async () => {
		await executor.close();
		await rm(root, { recursive: true, force: true });
	});
	const read = (await executor.execute(
		request("localDev", "read", { path: "package.json" }),
	)) as any;
	assert.equal(read.files.length, 1);
	assert.match(read.files[0].content, /fixture/);
	const search = (await executor.execute(
		request("localDev", "search", {
			path: ".",
			query: "DirectToolSymbol",
			mode: "literal",
			maxResults: 10,
		}),
	)) as any;
	assert.equal(
		search.matches.some((match: { path: string }) =>
			match.path.endsWith("source.ts"),
		),
		true,
	);
	assert.equal("outputId" in search, false);
	const directSource = await readFile(
		new URL("../src/direct-tools.ts", import.meta.url),
		"utf8",
	);
	assert.doesNotMatch(
		directSource,
		/ExecuteCapabilityRequest|ExecutionEvidence|ExecutionRecord|ExecutionRef/,
	);
	await executor.execute(
		request("localDev", "mutate", {
			action: "write",
			path: "nested/new.txt",
			content: "hello",
		}),
	);
	assert.equal(await readFile(join(root, "nested/new.txt"), "utf8"), "hello");
	const run = (await executor.execute(
		request("localDev", "run", {
			command: process.execPath,
			args: ["-e", "process.stdout.write('RUN_OK')"],
		}),
	)) as any;
	assert.equal(run.exitCode, 0);
	assert.equal(run.stdout, "RUN_OK");
	const started = (await executor.execute(
		request("localDev", "process", {
			action: "start",
			command: process.execPath,
			args: ["-e", "setInterval(()=>{},1000)"],
		}),
	)) as any;
	assert.match(started.processRef, /^process:/);
	const status = (await executor.execute(
		request("localDev", "process", {
			action: "status",
			processRef: started.processRef,
		}),
	)) as any;
	assert.equal(status.running, true);
	const stopped = (await executor.execute(
		request("localDev", "process", {
			action: "stop",
			processRef: started.processRef,
		}),
	)) as any;
	assert.equal(stopped.stopped, true);
	const stoppedStatus = (await executor.execute(
		request("localDev", "process", {
			action: "status",
			processRef: started.processRef,
		}),
	)) as any;
	assert.equal(stoppedStatus.running, false);
	await assert.rejects(
		() =>
			executor.execute(
				request("localDev", "process", {
					action: "start",
					command: join(root, "missing-executable"),
				}),
			),
		(error) =>
			error instanceof DirectToolError &&
			error.code === "TOOL_EXECUTION_FAILED",
	);

	const outside = await mkdtemp(join(tmpdir(), "proflow-direct-tools-secret-"));
	context.after(() => rm(outside, { recursive: true, force: true }));
	const secretDir = join(outside, ".proflow", "secrets");
	await mkdir(secretDir, { recursive: true });
	await writeFile(join(secretDir, "token"), "SHOULD_STAY_PROTECTED");
	await symlink(join(secretDir, "token"), join(root, "credential-link"));
	for (const path of [join(secretDir, "token"), "credential-link"])
		await assert.rejects(
			() => executor.execute(request("localDev", "read", { path })),
			(error) =>
				error instanceof DirectToolError && error.code === "TOOL_SCOPE_DENIED",
		);
	await assert.rejects(
		() =>
			executor.execute(
				request("localDev", "run", {
					command: process.execPath,
					args: ["-e", "process.stdout.write('NO')"],
					cwd: secretDir,
				}),
			),
		(error) =>
			error instanceof DirectToolError && error.code === "TOOL_SCOPE_DENIED",
	);
	await writeFile(join(outside, "visible.txt"), "VISIBLE"); await symlink(outside, join(root, "outside-link")); const notice = await executor.prepare(request("localDev", "read", { path: "outside-link/visible.txt" })); assert.match(notice.notices.join("\n"), /visible\.txt/); assert.match(notice.notices.join("\n"), /role=g-dev/); const argvNotice = await executor.prepare(request("localDev", "run", { command: process.execPath, args: [join(outside, "visible.txt")] })); assert.match(argvNotice.notices.join("\n"), /visible\.txt/); await assert.rejects(() => executor.execute({ ...request("localDev", "mutate", { action: "write", path: "expired.txt", content: "NO" }), deadlineAt: new Date(Date.now() - 1).toISOString() }), (error) => error instanceof DirectToolError && error.code === "TOOL_TIMEOUT");

});

test("CP-EXE-LOCAL-DIRECT-02 / CP-EXE-LOCAL-16 Repomix pack/grep/read returns within the Action budget without Execution polling", async (context) => {
	const { root, executor } = await fixture();
	context.after(async () => {
		await executor.close();
		await rm(root, { recursive: true, force: true });
	});
	const directSource = await readFile(
		new URL("../src/direct-tools.ts", import.meta.url),
		"utf8",
	);
	assert.doesNotMatch(
		directSource,
		/from "repomix"|from "@colbymchenry\/codegraph"/,
	);
	assert.match(directSource, /createProviderProcess\("repomix"/);
	assert.match(directSource, /createProviderProcess\("codeGraph"/);
	assert.match(directSource, /--provider-child/);
	assert.match(directSource, /fork\(/);
	await mkdir(join(root, ".proflow", "secrets"), { recursive: true });
	await writeFile(
		join(root, ".proflow", "secrets", "token"),
		"SHOULD_NOT_APPEAR",
	);
	const packed = (await executor.execute(
		request("repomix", "pack", { directory: "." }),
	)) as any;
	assert.match(packed.outputId, /^repomix-output:/);
	assert.ok(packed.totalFiles >= 2);
	const grep = (await executor.execute(
		request("repomix", "grep", {
			outputId: packed.outputId,
			pattern: "DirectToolSymbol",
		}),
	)) as any;
	assert.ok(grep.matches.length > 0);
	const read = (await executor.execute(
		request("repomix", "read", {
			outputId: packed.outputId,
			startLine: 1,
		}),
	)) as any;
	assert.match(read.content, /DirectToolSymbol/);
	assert.doesNotMatch(read.content, /SHOULD_NOT_APPEAR/);
	await assert.rejects(
		() =>
			executor.execute(
				request("repomix", "pack", {
					directory: ".",
					includePatterns: ["**/.proflow/**"],
				}),
			),
		(error) =>
			error instanceof DirectToolError && error.code === "TOOL_SCOPE_DENIED",
	);
});

test("CP-EXE-LOCAL-DIRECT-03 CodeGraph never initializes a project index implicitly", async (context) => {
	const { root, executor } = await fixture();
	context.after(async () => {
		await executor.close();
		await rm(root, { recursive: true, force: true });
	});
	await assert.rejects(
		() =>
			executor.execute(
				request("codeGraph", "explore", {
					projectPath: ".",
					query: "DirectToolSymbol",
				}),
			),
		(error) =>
			error instanceof DirectToolError &&
			error.code === "TOOL_PROVIDER_UNAVAILABLE",
	);
	await assert.rejects(() => readFile(join(root, ".codegraph", "index.db")));
});

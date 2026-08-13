import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { parseExecuteCapabilityRequest } from "@tomflow/proflow-execution-contracts";
import { createLocalExecutor, LocalExecutionError } from "../src/index.ts";

const exec = promisify(execFile);
const admission = {
	policy: "ALLOW",
	decisionPath: "reason",
	approval: "NOT_REQUIRED",
} as const;

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "proflow-execution-local-"));
	const artifacts = join(root, ".artifacts");
	await writeFile(
		join(root, "package.json"),
		JSON.stringify({
			name: "fixture",
			scripts: { test: "node -e \"console.log('PASS')\"" },
		}),
	);
	await writeFile(
		join(root, "source.ts"),
		"export const WaveThreeSymbol = 3;\n",
	);
	await writeFile(join(root, ".gitignore"), "node_modules/\n");
	await exec("git", ["init", "-q"], { cwd: root });
	await exec("git", ["config", "user.name", "ProFlow Test"], { cwd: root });
	await exec("git", ["config", "user.email", "test@proflow.invalid"], {
		cwd: root,
	});
	await exec("git", ["add", "."], { cwd: root });
	await exec("git", ["commit", "-qm", "fixture"], { cwd: root });
	return {
		root,
		artifacts,
		executor: await createLocalExecutor({
			projectRoot: root,
			artifactRoot: artifacts,
		}),
	};
}

function request(
	capability: string,
	input: unknown,
	root: string,
	key = capability,
) {
	return parseExecuteCapabilityRequest({
		contract: "execution",
		contractVersion: "1.0.0",
		callerRef: "caller:test",
		idempotencyKey: key,
		projectRoot: root,
		capability,
		input,
	});
}

async function run(
	executor: Awaited<ReturnType<typeof createLocalExecutor>>,
	root: string,
	capability: string,
	input: unknown,
) {
	return executor.execute({
		request: request(capability, input, root),
		admission,
		onEffectStarted: async () => undefined,
	});
}

test("CP-EXE-LOCAL-01 projectRoot boundary rejects traversal, absolute, symlink and .proflow", async () => {
	const { root, executor } = await fixture();
	const outside = await mkdtemp(join(tmpdir(), "proflow-outside-"));
	await writeFile(join(outside, "secret"), "no");
	await symlink(outside, join(root, "escape"));
	for (const path of [
		"../secret",
		join(outside, "secret"),
		"escape/secret",
		".proflow/state.db",
	]) {
		await assert.rejects(
			() => run(executor, root, "file.read", { path }),
			(error) =>
				error instanceof LocalExecutionError && error.code === "SCOPE_DENIED",
		);
	}
	const valid = await run(executor, root, "file.read", { path: "source.ts" });
	assert.equal(valid.result.capability, "file.read");
});

test("CP-EXE-LOCAL-02 real file, Git, project, quality and code capability families", async () => {
	const { root, executor } = await fixture();
	const write = await run(executor, root, "file.write", {
		path: "nested/new.ts",
		content: "export const Added = 1;\n",
		createParents: true,
	});
	assert.equal(write.effectApplied, true);
	assert.equal(
		await readFile(join(root, "nested/new.ts"), "utf8"),
		"export const Added = 1;\n",
	);
	assert.equal(
		(await run(executor, root, "git.status", {})).result.capability,
		"git.status",
	);
	assert.equal(
		(await run(executor, root, "project.info", {})).result.capability,
		"project.info",
	);
	const search = await run(executor, root, "code.findSymbol", {
		symbol: "WaveThreeSymbol",
	});
	assert.equal(search.result.capability, "code.findSymbol");
	assert.ok(search.result.data.matches.length > 0);
	const quality = await run(executor, root, "quality.test", { script: "test" });
	assert.equal(quality.successful, true);
	const dependency = join(root, "dependency-fixture");
	await mkdir(dependency);
	await writeFile(
		join(dependency, "package.json"),
		JSON.stringify({
			name: "proflow-local-dependency-fixture",
			version: "1.0.0",
		}),
	);
	const installed = await run(executor, root, "project.installDependency", {
		packageName: "./dependency-fixture",
		packageManager: "npm",
	});
	assert.equal(installed.result.capability, "project.installDependency");
	assert.equal(installed.successful, true);
	const commit = await run(executor, root, "git.commit", {
		message: "test: real mutation",
		paths: ["nested/new.ts"],
	});
	assert.equal(commit.result.capability, "git.commit");
});

test("CP-EXE-LOCAL-03 process lifecycle, bounded output, timeout and managed stop", async () => {
	const { root, executor } = await fixture();
	const output = await run(executor, root, "process.start", {
		mode: "one-shot",
		command: process.execPath,
		args: ["-e", "console.log('x'.repeat(5000))"],
		maxOutputBytes: 64,
	});
	assert.equal(output.result.capability, "process.start");
	if (output.result.data.mode !== "one-shot") assert.fail("expected one-shot");
	assert.ok(output.result.data.output.stdoutSummary.length <= 64);
	await assert.rejects(
		() =>
			run(executor, root, "process.start", {
				mode: "one-shot",
				command: process.execPath,
				args: ["-e", "setInterval(()=>{},1000)"],
				timeoutMs: 80,
			}),
		(error) => error instanceof LocalExecutionError && error.code === "TIMEOUT",
	);
	const controller = new AbortController();
	const cancelled = executor.execute({
		request: request(
			"process.start",
			{
				mode: "one-shot",
				command: process.execPath,
				args: ["-e", "setInterval(()=>{},1000)"],
				timeoutMs: 5_000,
			},
			root,
		),
		admission,
		signal: controller.signal,
		onEffectStarted: async () => undefined,
	});
	setTimeout(() => controller.abort(), 40);
	await assert.rejects(
		() => cancelled,
		(error) =>
			error instanceof LocalExecutionError && error.code === "CANCELLED",
	);
	const managed = await run(executor, root, "process.start", {
		mode: "managed",
		command: process.execPath,
		args: ["-e", "console.log('READY');setInterval(()=>{},1000)"],
		readiness: { kind: "log", pattern: "READY" },
		timeoutMs: 2_000,
	});
	if (
		managed.result.capability !== "process.start" ||
		managed.result.data.mode !== "managed"
	)
		assert.fail("expected managed");
	const reopened = await createLocalExecutor({
		projectRoot: root,
		artifactRoot: join(root, ".artifacts"),
	});
	const status = await run(reopened, root, "process.status", {
		processRef: managed.result.data.processRef,
	});
	assert.equal(
		status.result.capability === "process.status" && status.result.data.state,
		"RUNNING",
	);
	const stopped = await run(reopened, root, "process.stop", {
		processRef: managed.result.data.processRef,
	});
	assert.equal(
		stopped.result.capability === "process.stop" && stopped.result.data.stopped,
		true,
	);
});

test("CP-EXE-LOCAL-04 deterministic local network boundary permits loopback and denies public", async () => {
	const { root, executor } = await fixture();
	let receivedAuthorization = false;
	const server = createServer((_request, response) => {
		receivedAuthorization =
			_request.headers.authorization === "Bearer local-proof";
		response.setHeader("authorization", "secret");
		response.end("ok");
	});
	await new Promise<void>((resolveListen) =>
		server.listen(0, "127.0.0.1", resolveListen),
	);
	const address = server.address();
	if (address === null || typeof address === "string")
		assert.fail("missing port");
	try {
		const result = await run(executor, root, "network.request", {
			url: `http://127.0.0.1:${address.port}/health`,
			method: "GET",
			headers: { authorization: "Bearer local-proof" },
		});
		assert.equal(
			result.result.capability === "network.request" &&
				result.result.data.status,
			200,
		);
		if (result.result.capability === "network.request")
			assert.equal(result.result.data.headers.authorization, undefined);
		assert.equal(receivedAuthorization, true);
		await assert.rejects(
			() =>
				run(executor, root, "network.request", {
					url: "https://example.com/",
					method: "GET",
				}),
			(error) =>
				error instanceof LocalExecutionError && error.code === "SCOPE_DENIED",
		);
	} finally {
		server.close();
	}
});

test("CP-EXE-LOCAL-05 guarded shell rejects direct and dangerous escape, permits safe argv", async () => {
	const { root, executor } = await fixture();
	await assert.rejects(
		() =>
			executor.execute({
				request: request(
					"shell.run",
					{ command: process.execPath, args: ["-e", "console.log(1)"] },
					root,
				),
				admission: { ...admission, decisionPath: "deterministic" },
				onEffectStarted: async () => undefined,
			}),
		(error) =>
			error instanceof LocalExecutionError && error.code === "POLICY_DENIED",
	);
	await assert.rejects(
		() =>
			executor.execute({
				request: request(
					"shell.run",
					{ command: "sudo", args: ["true"] },
					root,
				),
				admission: { ...admission, approval: "VALID" },
				onEffectStarted: async () => undefined,
			}),
		(error) =>
			error instanceof LocalExecutionError && error.code === "POLICY_DENIED",
	);
	const safe = await executor.execute({
		request: request(
			"shell.run",
			{ command: process.execPath, args: ["-e", "console.log('safe')"] },
			root,
		),
		admission: { ...admission, approval: "VALID" },
		onEffectStarted: async () => undefined,
	});
	assert.equal(safe.successful, true);
});

test("CP-EXE-LOCAL-06 environment redaction and file/Git reality recovery", async () => {
	const { root, artifacts } = await fixture();
	const executor = await createLocalExecutor({
		projectRoot: root,
		artifactRoot: artifacts,
		baseEnv: { PROFLOW_SECRET_TOKEN: "never-leak-me" },
	});
	const result = await run(executor, root, "process.start", {
		mode: "one-shot",
		command: process.execPath,
		args: ["-e", "console.log(process.env.PROFLOW_SECRET_TOKEN)"],
		maxOutputBytes: 100,
	});
	if (
		result.result.capability !== "process.start" ||
		result.result.data.mode !== "one-shot"
	)
		assert.fail("expected one-shot");
	assert.equal(
		result.result.data.output.stdoutSummary.includes("never-leak-me"),
		false,
	);
	let filePrecondition: Parameters<typeof executor.reconcile>[1] | undefined;
	await executor.execute({
		request: request(
			"file.write",
			{ path: "recover.txt", content: "applied" },
			root,
		),
		admission,
		onEffectStarted: (value) => {
			filePrecondition = value;
		},
	});
	assert.ok(filePrecondition);
	assert.equal(
		(
			await executor.reconcile(
				request(
					"file.write",
					{ path: "recover.txt", content: "applied" },
					root,
				),
				filePrecondition,
			)
		).state,
		"APPLIED",
	);
	let gitPrecondition: Parameters<typeof executor.reconcile>[1] | undefined;
	await writeFile(join(root, "git-recover.txt"), "applied");
	const commitRequest = request(
		"git.commit",
		{ message: "test: reconcile", paths: ["git-recover.txt"] },
		root,
	);
	await executor.execute({
		request: commitRequest,
		admission,
		onEffectStarted: (value) => {
			gitPrecondition = value;
		},
	});
	assert.ok(gitPrecondition);
	assert.equal(
		(await executor.reconcile(commitRequest, gitPrecondition)).state,
		"APPLIED",
	);
});

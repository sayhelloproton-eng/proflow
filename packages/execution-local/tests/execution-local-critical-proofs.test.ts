import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
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
	await writeFile(join(root, "output.mjs"), "console.log('x'.repeat(5000));\n");
	await writeFile(join(root, "hang.mjs"), "setInterval(()=>{},1000);\n");
	await writeFile(
		join(root, "ready.mjs"),
		"console.log('READY');setInterval(()=>{},1000);\n",
	);
	await writeFile(
		join(root, "secret.mjs"),
		"console.log(process.env.PROFLOW_SECRET_TOKEN);\n",
	);
	await writeFile(join(root, "safe.mjs"), "console.log('safe');\n");
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
		args: ["output.mjs"],
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
				args: ["hang.mjs"],
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
				args: ["hang.mjs"],
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
		args: ["ready.mjs"],
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
		await assert.rejects(
			() =>
				run(executor, root, "network.request", {
					url: "http://169.254.169.254/latest/meta-data/",
					method: "GET",
				}),
			(error) =>
				error instanceof LocalExecutionError && error.code === "SCOPE_DENIED",
		);
	} finally {
		server.close();
	}
});

test("carry-forward process scope rejects PATH and secret injection and one-shot absence stays UNKNOWN", async () => {
	const { root, executor } = await fixture();
	await assert.rejects(
		() =>
			run(executor, root, "process.start", {
				mode: "one-shot",
				command: process.execPath,
				args: ["safe.mjs"],
				env: { PATH: "/tmp/attacker", API_TOKEN: "plaintext" },
			}),
		(error) =>
			error instanceof LocalExecutionError && error.code === "SCOPE_DENIED",
	);
	let precondition: Parameters<typeof executor.reconcile>[1] | undefined;
	await executor.execute({
		request: request(
			"process.start",
			{ mode: "one-shot", command: process.execPath, args: ["safe.mjs"] },
			root,
		),
		admission,
		onEffectStarted(value) {
			precondition = value;
		},
	});
	assert.ok(precondition);
	assert.equal(
		(
			await executor.reconcile(
				request(
					"process.start",
					{ mode: "one-shot", command: process.execPath, args: ["safe.mjs"] },
					root,
				),
				precondition,
			)
		).state,
		"UNKNOWN",
	);
});

test("carry-forward managed process ownership rejects a reused PID identity", async () => {
	const { root, artifacts } = await fixture();
	await writeFile(
		join(artifacts, "managed-processes.json"),
		JSON.stringify([
			{
				processRef: "process:stale",
				pid: process.pid,
				command: "definitely-not-this-process",
				args: [],
				stdoutRef: "output:stale:stdout",
				stderrRef: "output:stale:stderr",
				stdoutPath: join(artifacts, "stale.stdout.log"),
				stderrPath: join(artifacts, "stale.stderr.log"),
				startedAt: new Date(0).toISOString(),
				processIdentity: "stale-process-identity",
			},
		]),
	);
	const reopened = await createLocalExecutor({
		projectRoot: root,
		artifactRoot: artifacts,
	});
	const status = await run(reopened, root, "process.status", {
		processRef: "process:stale",
	});
	assert.equal(
		status.result.capability === "process.status" && status.result.data.state,
		"STOPPED",
	);
	await assert.rejects(
		() => run(reopened, root, "process.stop", { processRef: "process:stale" }),
		(error) =>
			error instanceof LocalExecutionError && error.code === "SCOPE_DENIED",
	);
});

test("carry-forward failed git commit with a changed index is UNKNOWN rather than NOT_APPLIED", async () => {
	const { root, executor } = await fixture();
	await writeFile(join(root, "partial.txt"), "partial");
	await exec("git", ["config", "commit.gpgsign", "true"], { cwd: root });
	await exec("git", ["config", "gpg.program", "/usr/bin/false"], { cwd: root });
	let precondition: Parameters<typeof executor.reconcile>[1] | undefined;
	const commitRequest = request(
		"git.commit",
		{ message: "test: must fail after staging", paths: ["partial.txt"] },
		root,
	);
	await assert.rejects(() =>
		executor.execute({
			request: commitRequest,
			admission,
			onEffectStarted(value) {
				precondition = value;
			},
		}),
	);
	assert.ok(precondition);
	assert.equal(
		(await executor.reconcile(commitRequest, precondition)).state,
		"UNKNOWN",
	);
});

test("CP-EXE-LOCAL-05 guarded shell rejects direct and dangerous escape, permits safe argv", async () => {
	const { root, executor } = await fixture();
	await assert.rejects(
		() =>
			executor.execute({
				request: request(
					"shell.run",
					{ command: process.execPath, args: ["safe.mjs"] },
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
			{ command: process.execPath, args: ["safe.mjs"] },
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
		args: ["secret.mjs"],
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

test("B1-EXE-10 reconcile reconstructs the concrete Result for file.write and git.commit", async () => {
	const { root, executor } = await fixture();
	let filePrecondition: Parameters<typeof executor.reconcile>[1] | undefined;
	await executor.execute({
		request: request(
			"file.write",
			{ path: "recovered.txt", content: "reconciled" },
			root,
		),
		admission,
		onEffectStarted: (value) => {
			filePrecondition = value;
		},
	});
	assert.ok(filePrecondition);
	const fileReconciled = await executor.reconcile(
		request(
			"file.write",
			{ path: "recovered.txt", content: "reconciled" },
			root,
		),
		filePrecondition,
	);
	assert.equal(fileReconciled.state, "APPLIED");
	const fileResult = fileReconciled.result;
	assert.ok(fileResult);
	if (!fileResult || fileResult.capability !== "file.write")
		assert.fail("expected file.write result");
	assert.equal(fileResult.data.path, "recovered.txt");
	assert.equal(typeof fileResult.data.afterHash, "string");
	assert.equal(fileResult.data.bytes, Buffer.byteLength("reconciled"));

	let gitPrecondition: Parameters<typeof executor.reconcile>[1] | undefined;
	await writeFile(join(root, "git-recovered.txt"), "committed");
	const commitRequest = request(
		"git.commit",
		{ message: "test: recover", paths: ["git-recovered.txt"] },
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
	const gitReconciled = await executor.reconcile(
		commitRequest,
		gitPrecondition,
	);
	assert.equal(gitReconciled.state, "APPLIED");
	const gitResult = gitReconciled.result;
	assert.ok(gitResult);
	if (!gitResult || gitResult.capability !== "git.commit")
		assert.fail("expected git.commit result");
	assert.equal(typeof gitResult.data.commitSha, "string");
	assert.equal(gitResult.data.head, gitResult.data.commitSha);
});

test("B1-EXE-04 installDependency crash recovers reality from package.json/lockfile", async () => {
	const { root, executor } = await fixture();
	const installRequest = request(
		"project.installDependency",
		{ packageName: "./recover-dep", packageManager: "npm" },
		root,
	);

	// NOT_APPLIED: manifest and lockfile both unchanged before any install.
	const beforeManifest = createHash("sha256")
		.update(await readFile(join(root, "package.json")))
		.digest("hex");
	const notApplied = await executor.reconcile(installRequest, {
		kind: "install-dependency",
		capability: "project.installDependency",
		packageManager: "npm",
		requested: "./recover-dep",
		dev: false,
		beforeManifestHash: `sha256:${beforeManifest}`,
	});
	assert.equal(notApplied.state, "NOT_APPLIED");

	// APPLIED: a real install mutates package.json, then reconcile reconstructs Result.
	await mkdir(join(root, "recover-dep"));
	await writeFile(
		join(root, "recover-dep", "package.json"),
		JSON.stringify({ name: "proflow-recover-dep", version: "1.0.0" }),
	);
	let precondition: Parameters<typeof executor.reconcile>[1] | undefined;
	await executor.execute({
		request: installRequest,
		admission,
		onEffectStarted: (value) => {
			precondition = value;
		},
	});
	assert.ok(precondition);
	if (!precondition || precondition.kind !== "install-dependency")
		assert.fail("expected install-dependency precondition");
	const reconciled = await executor.reconcile(installRequest, precondition);
	assert.equal(reconciled.state, "APPLIED");
	const result = reconciled.result;
	assert.ok(result);
	if (!result || result.capability !== "project.installDependency")
		assert.fail("expected project.installDependency result");
	assert.equal(result.data.manifestChanged, true);
	assert.equal(result.data.lockfileChanged, true);
	assert.equal(result.data.packageManager, "npm");
	assert.equal(result.data.requested, "./recover-dep");
	assert.equal(result.data.output.exitCode, 0);
});

test("B1-EXE-09 output summary is UTF-8 byte-bounded and secrets are redacted across chunk boundaries", async () => {
	const { root, artifacts } = await fixture();
	const secret = "SPLIT-SECRET-7f3a";
	await writeFile(
		join(root, "split.mjs"),
		[
			"process.stdout.write(process.env.PROFLOW_SPLIT_SECRET.slice(0, 6));",
			"await new Promise(r => setTimeout(r, 30));",
			"process.stdout.write(process.env.PROFLOW_SPLIT_SECRET.slice(6) + '\\n');",
			"process.stdout.write('你好世界'.repeat(64));",
			"",
		].join("\n"),
	);
	const executor = await createLocalExecutor({
		projectRoot: root,
		artifactRoot: artifacts,
		baseEnv: { PROFLOW_SPLIT_SECRET: secret },
	});
	const result = await run(executor, root, "process.start", {
		mode: "one-shot",
		command: process.execPath,
		args: ["split.mjs"],
		maxOutputBytes: 128,
	});
	if (
		result.result.capability !== "process.start" ||
		result.result.data.mode !== "one-shot"
	)
		assert.fail("expected one-shot");
	const { stdoutSummary } = result.result.data.output;
	assert.equal(stdoutSummary.includes(secret), false);
	assert.ok(Buffer.byteLength(stdoutSummary) <= 128);
	const stdoutArtifact = result.artifacts.find(
		(artifact) => artifact.stream === "stdout",
	);
	assert.ok(stdoutArtifact);
	const onDisk = await readFile(stdoutArtifact.path, "utf8");
	assert.equal(onDisk.includes(secret), false);
	assert.equal(onDisk.includes("你好世界"), true);
});

test("B1-EXE-06 managed process identity, crash-before-persist and stop recovery reconcile", async () => {
	const { root, executor } = await fixture();
	const startRequest = request(
		"process.start",
		{
			mode: "managed",
			command: process.execPath,
			args: ["ready.mjs"],
			readiness: { kind: "log", pattern: "READY" },
			timeoutMs: 2_000,
		},
		root,
	);

	// spawn 后、registry persist 前故障注入：EFFECT_STARTED 已触发但 registry
	// 缺失，绝不能得到 NOT_APPLIED（那会触发盲目重启），只能 UNKNOWN。
	const ghost = await executor.reconcile(startRequest, {
		kind: "process.start",
		capability: "process.start",
		processRef: "process:ghost",
		mode: "managed",
	});
	assert.equal(ghost.state, "UNKNOWN");

	// managed start lost response + durable registry reality → APPLIED + Result。
	let startPrecondition: Parameters<typeof executor.reconcile>[1] | undefined;
	await executor.execute({
		request: startRequest,
		admission,
		onEffectStarted: (value) => {
			startPrecondition = value;
		},
	});
	assert.ok(startPrecondition);
	if (!startPrecondition || startPrecondition.kind !== "process.start")
		assert.fail("expected process.start precondition");
	const processRef = startPrecondition.processRef;
	const started = await executor.reconcile(startRequest, startPrecondition);
	assert.equal(started.state, "APPLIED");
	assert.ok(started.result);
	if (!started.result || started.result.capability !== "process.start")
		assert.fail("expected process.start result");
	assert.equal(started.result.data.mode, "managed");
	assert.equal(started.result.data.processRef, processRef);
	assert.equal(started.result.data.ready, true);
	assert.equal(typeof started.result.data.stdoutRef, "string");
	assert.equal(typeof started.result.data.stderrRef, "string");

	// stop never happened：进程仍在运行、registry 仍存在 → NOT_APPLIED。
	const notStopped = await executor.reconcile(
		request("process.stop", { processRef }, root),
		{
			kind: "process.stop",
			capability: "process.stop",
			processRef,
		},
	);
	assert.equal(notStopped.state, "NOT_APPLIED");

	// stop lost response：effect 已完成（进程被 kill、registry 删除）但调用方
	// 未收到响应 → reality reconcile 返回 APPLIED，且不重复/误杀。
	let stopPrecondition: Parameters<typeof executor.reconcile>[1] | undefined;
	await executor.execute({
		request: request("process.stop", { processRef }, root),
		admission,
		onEffectStarted: (value) => {
			stopPrecondition = value;
		},
	});
	assert.ok(stopPrecondition);
	if (!stopPrecondition || stopPrecondition.kind !== "process.stop")
		assert.fail("expected process.stop precondition");
	assert.equal(stopPrecondition.processRef, processRef);
	assert.equal(typeof stopPrecondition.birthIdentity, "string");
	assert.ok((stopPrecondition.birthIdentity ?? "").length > 0);
	const stopped = await executor.reconcile(
		request("process.stop", { processRef }, root),
		stopPrecondition,
	);
	assert.equal(stopped.state, "APPLIED");
	assert.ok(stopped.result);
	if (!stopped.result || stopped.result.capability !== "process.stop")
		assert.fail("expected process.stop result");
	assert.equal(stopped.result.data.processRef, processRef);
	assert.equal(stopped.result.data.stopped, true);
	assert.equal(stopped.evidence.length, 0);
});

test("B1-EXE-07 network.request followRedirects validates every hop and strips cross-origin credentials", async () => {
	const { root, executor } = await fixture();

	let finalReceivedAuthorization = false;
	const finalServer = createServer((_request, response) => {
		finalReceivedAuthorization = _request.headers.authorization !== undefined;
		response.end("final");
	});
	await new Promise<void>((resolveListen) =>
		finalServer.listen(0, "127.0.0.1", resolveListen),
	);
	const finalAddress = finalServer.address();
	if (finalAddress === null || typeof finalAddress === "string")
		assert.fail("missing final port");
	const finalUrl = `http://127.0.0.1:${finalAddress.port}/final`;

	const redirectServer = createServer((_request, response) => {
		response.statusCode = 302;
		response.setHeader("location", finalUrl);
		response.end();
	});
	await new Promise<void>((resolveListen) =>
		redirectServer.listen(0, "127.0.0.1", resolveListen),
	);
	const redirectAddress = redirectServer.address();
	if (redirectAddress === null || typeof redirectAddress === "string")
		assert.fail("missing redirect port");

	const publicRedirectServer = createServer((_request, response) => {
		response.statusCode = 302;
		response.setHeader("location", "https://example.com/escaped");
		response.end();
	});
	await new Promise<void>((resolveListen) =>
		publicRedirectServer.listen(0, "127.0.0.1", resolveListen),
	);
	const publicRedirectAddress = publicRedirectServer.address();
	if (
		publicRedirectAddress === null ||
		typeof publicRedirectAddress === "string"
	)
		assert.fail("missing public-redirect port");

	const loopServer = createServer((_request, response) => {
		response.statusCode = 302;
		response.setHeader("location", "/loop");
		response.end();
	});
	await new Promise<void>((resolveListen) =>
		loopServer.listen(0, "127.0.0.1", resolveListen),
	);
	const loopAddress = loopServer.address();
	if (loopAddress === null || typeof loopAddress === "string")
		assert.fail("missing loop port");

	try {
		// default (no followRedirects) fails closed on any redirect.
		await assert.rejects(
			() =>
				run(executor, root, "network.request", {
					url: `http://127.0.0.1:${redirectAddress.port}/start`,
					method: "GET",
				}),
			(error) =>
				error instanceof LocalExecutionError && error.code === "SCOPE_DENIED",
		);

		// followRedirects=true follows a same-scope hop and strips the
		// cross-origin Authorization header.
		const followed = await run(executor, root, "network.request", {
			url: `http://127.0.0.1:${redirectAddress.port}/start`,
			method: "GET",
			headers: { authorization: "Bearer cross-origin-proof" },
			followRedirects: true,
		});
		assert.equal(
			followed.result.capability === "network.request" &&
				followed.result.data.status,
			200,
		);
		if (followed.result.capability === "network.request") {
			assert.equal(followed.result.data.url, finalUrl);
			assert.equal(followed.result.data.bodySummary, "final");
		}
		assert.equal(finalReceivedAuthorization, false);

		// a hop that escapes the deterministic scope fails closed.
		await assert.rejects(
			() =>
				run(executor, root, "network.request", {
					url: `http://127.0.0.1:${publicRedirectAddress.port}/start`,
					method: "GET",
					followRedirects: true,
				}),
			(error) =>
				error instanceof LocalExecutionError && error.code === "SCOPE_DENIED",
		);

		// an unbounded self-loop is cut off by the hop limit, still fail-closed.
		await assert.rejects(
			() =>
				run(executor, root, "network.request", {
					url: `http://127.0.0.1:${loopAddress.port}/start`,
					method: "GET",
					followRedirects: true,
				}),
			(error) =>
				error instanceof LocalExecutionError && error.code === "SCOPE_DENIED",
		);
	} finally {
		redirectServer.close();
		finalServer.close();
		publicRedirectServer.close();
		loopServer.close();
	}
});

test("B1-EXE-08 network response body streams to a redacted byte-bounded artifact", async () => {
	const { root, executor } = await fixture();
	const secret = "UNIQUE-B1-EXE-08-5d3e";
	const server = createServer((request, response) => {
		let body = "";
		request.on("data", (chunk) => {
			body += chunk.toString();
		});
		request.on("end", () => {
			response.setHeader("content-type", "application/json");
			response.end(
				JSON.stringify({
					auth: request.headers.authorization ?? "",
					echoedBody: body,
					note: "hello",
				}),
			);
		});
	});
	await new Promise<void>((resolveListen) =>
		server.listen(0, "127.0.0.1", resolveListen),
	);
	const address = server.address();
	if (address === null || typeof address === "string")
		assert.fail("missing port");
	try {
		const result = await run(executor, root, "network.request", {
			url: `http://127.0.0.1:${address.port}/`,
			method: "POST",
			headers: { authorization: `Bearer ${secret}` },
			body: `password=${secret}`,
			maxOutputBytes: 256,
		});
		assert.equal(
			result.result.capability === "network.request" &&
				result.result.data.status,
			200,
		);
		if (result.result.capability !== "network.request")
			assert.fail("expected network.request");
		const { bodySummary } = result.result.data;
		assert.equal(bodySummary.includes(secret), false);
		assert.ok(bodySummary.includes("[REDACTED]"));
		assert.ok(Buffer.byteLength(bodySummary) <= 256);
		const bodyArtifact = result.artifacts.find(
			(artifact) => artifact.stream === "report",
		);
		assert.ok(bodyArtifact);
		const onDisk = await readFile(bodyArtifact.path, "utf8");
		assert.equal(onDisk.includes(secret), false);
	} finally {
		server.close();
	}
});

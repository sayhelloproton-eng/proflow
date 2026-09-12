import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createExtensionLogger } from "../extension/runtime/extension-logger.ts";

function memoryStorage() {
	const values: Record<string, unknown> = {};
	return {
		values,
		async get(key: string) {
			return { [key]: values[key] };
		},
		async set(input: Record<string, unknown>) {
			Object.assign(values, input);
		},
	};
}

test("aggregated extension operation records survive sink outage and preserve success/error semantics", async () => {
	const storage = memoryStorage();
	let fail = true;
	const remote: Array<Record<string, unknown>> = [];
	let eventNo = 0;
	const logger = createExtensionLogger({
		storage,
		getExtensionInstanceId: () => "extension:1",
		moduleVersion: "0.1.57",
		idFactory: () => `event-${++eventNo}`,
		now: () => new Date("2026-09-12T08:00:00.000Z"),
		async remoteWrite(entry) {
			if (fail) throw new Error("LOG_SINK_UNAVAILABLE");
			remote.push(entry);
		},
	});
	await logger.emit({
		component: "permission-boundary",
		event: "PERMISSION_OPERATION",
		status: "BLOCKED",
		decision: "HUMAN_REQUIRED",
		reason: "ROLE_VALIDATION_MISMATCH",
		conversationLocator: "https://chatgpt.com/g/g-dev/c/c-1?secret=query#fragment",
		roleRef: "g-dev",
		workerRef: "worker:1",
		operationRef: "permission:1",
	});
	await logger.flush();
	assert.equal((await logger.snapshot()).bufferedEvents, 1);
	assert.equal((await logger.snapshot()).lastFlushErrorCode, "LOG_SINK_UNAVAILABLE");

	fail = false;
	await logger.flush();
	assert.equal((await logger.snapshot()).bufferedEvents, 0);
	assert.equal(remote.length, 1);
	assert.equal(remote[0]?.operation, "PERMISSION_OPERATION:HUMAN_REQUIRED");
	assert.equal(remote[0]?.status, "BLOCKED");
	assert.equal(remote[0]?.errorCode, "ROLE_VALIDATION_MISMATCH");
	assert.equal(remote[0]?.conversationLocator, "https://chatgpt.com/g/g-dev/c/c-1");
	assert.doesNotMatch(JSON.stringify(remote), /secret=query|fragment/);

	await logger.emit({
		component: "permission-boundary",
		event: "PERMISSION_OPERATION",
		status: "SUCCEEDED",
		decision: "AUTO_ALLOW",
		reason: "TRUSTED_ACTION",
		operationRef: "permission:2",
	});
	await logger.flush();
	assert.equal(remote.length, 2);
	assert.equal(remote[1]?.operation, "PERMISSION_OPERATION:AUTO_ALLOW");
	assert.equal(remote[1]?.status, "SUCCEEDED");
	assert.equal("errorCode" in (remote[1] ?? {}), false);
});

test("browser observability is aggregated at composition boundaries, not scattered through business controllers", async () => {
	const [
		observer,
		permission,
		localTool,
		provisioning,
		browserSession,
		background,
		router,
	] = await Promise.all([
		readFile(new URL("../extension/runtime/operation-observer.ts", import.meta.url), "utf8"),
		readFile(new URL("../extension/runtime/permission-controller.ts", import.meta.url), "utf8"),
		readFile(new URL("../extension/runtime/local-tool-lane.ts", import.meta.url), "utf8"),
		readFile(new URL("../extension/runtime/provisioning-lane.ts", import.meta.url), "utf8"),
		readFile(new URL("../extension/runtime/browser-session-lane.ts", import.meta.url), "utf8"),
		readFile(new URL("../extension/background.ts", import.meta.url), "utf8"),
		readFile(new URL("../extension/runtime/runtime-message-router.ts", import.meta.url), "utf8"),
	]);

	for (const event of [
		"PERMISSION_OPERATION",
		"BROWSER_COMMAND",
		"PAGE_REALITY_TRANSITION",
		"LOCAL_TOOL_SESSION_STATE",
		"PROVISIONING_COMMAND",
		"HOST_APPLICATION",
	]) assert.match(observer, new RegExp(event));

	for (const source of [permission, localTool, provisioning, browserSession]) {
		assert.doesNotMatch(source, /\bemitEvent\b/);
		assert.doesNotMatch(
			source,
			/\b(?:PERMISSION_DETECTED|PERMISSION_CLASSIFIED|LOCAL_TOOL_COMMAND_RECEIVED|PROVISIONING_EFFECT_STARTED|BROWSER_COMMAND_RECEIVED)\b/,
		);
	}

	assert.match(background, /createExtensionOperationObserver/);
	assert.match(background, /wrapHostApplication\("task"/);
	assert.match(background, /wrapHostApplication\(\s*"approval"/);
	assert.match(router, /observabilitySnapshot/);
	assert.doesNotMatch(localTool, /\b(?:taskId|nodeId|workerRef|conversationLocator)\b/);
	assert.doesNotMatch(
		provisioning,
		/\b(?:taskId|nodeId|workerRef|conversationLocator|executionRef)\b/,
	);
});

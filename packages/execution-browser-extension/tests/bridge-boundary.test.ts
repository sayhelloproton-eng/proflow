import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("Bridge server is composition and transport owners stay isolated", async () => {
	const [bridge, commandBus, taskWeb, executor, protocol, client] =
		await Promise.all([
			read("../src/bridge.ts"),
			read("../src/bridge-command-bus.ts"),
			read("../src/bridge-task-web.ts"),
			read("../src/bridge-executor-router.ts"),
			read("../src/bridge-protocol.ts"),
			read("../src/bridge-client.ts"),
		]);
	for (const owner of [
		"createBridgeCommandBus",
		"createBridgeTaskWeb",
		"createBridgeExecutorRouter",
	])
		assert.match(bridge, new RegExp(owner));
	for (const leaked of [
		/const queue:/,
		/const pending = new Map/,
		/taskBootstrap = new Map/,
		/taskSessions = new Map/,
		/function parseExecutorCommand/,
		/function createBrowserPort/,
	])
		assert.doesNotMatch(bridge, leaked);
	assert.match(commandBus, /const queue:/);
	assert.match(commandBus, /const pending = new Map/);
	assert.match(taskWeb, /taskBootstrap = new Map/);
	assert.match(taskWeb, /taskSessions = new Map/);
	assert.match(executor, /parseExecutorCommand/);
	assert.match(protocol, /from "\.\/browser-reality\.ts"/);
	assert.doesNotMatch(protocol, /from "\.\/index\.ts"/);
	assert.match(client, /createBrowserPort/);
});

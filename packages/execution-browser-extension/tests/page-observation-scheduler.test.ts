import assert from "node:assert/strict";
import { test } from "node:test";

import { detectActionPermission } from "../src/carrier-permission.ts";
import {
	createBoundedPageObservationScheduler,
	pageObservationMutationOptions,
} from "../src/page-observation-scheduler.ts";

test("CP-EXE-BR-43 page observation includes text-node hydration via characterData", () => {
	assert.deepEqual(pageObservationMutationOptions, {
		subtree: true,
		childList: true,
		attributes: true,
		characterData: true,
	});
	const buttons = ["拒绝", "允许"];
	assert.equal(
		detectActionPermission([{ text: "加载中", buttonLabels: buttons }]),
		null,
	);
	const hydrated = detectActionPermission([
		{
			text: "“部署 + 测试验收”希望与“0br1cj2q-41705.jpe1.devtunnels.ms”对话 工具调用：0br1cj2q_41705_jpe1_devtunnels_ms__jit_plugin.localDev",
			buttonLabels: buttons,
		},
	]);
	assert.ok(hydrated);
	assert.equal(hydrated.operationId, "localDev");
	assert.deepEqual(hydrated.actions, ["deny", "allow"]);
});

test("CP-EXE-BR-22 page observation coalesces mutation bursts without trailing-debounce starvation", () => {
	const callbacks: Array<() => void> = [];
	const delays: number[] = [];
	let publishCount = 0;
	const scheduler = createBoundedPageObservationScheduler({
		publish() {
			publishCount += 1;
		},
		schedule(callback, delayMs) {
			callbacks.push(callback);
			delays.push(delayMs);
			return callbacks.length;
		},
	});

	assert.equal(scheduler.request(), true);
	for (let index = 0; index < 50; index += 1)
		assert.equal(scheduler.request(), false);
	assert.deepEqual(delays, [100]);
	assert.equal(publishCount, 0);
	assert.equal(scheduler.pending(), true);

	callbacks.shift()?.();
	assert.equal(publishCount, 1);
	assert.equal(scheduler.pending(), false);
	assert.equal(scheduler.request(), true);
	assert.deepEqual(delays, [100, 100]);
	callbacks.shift()?.();
	assert.equal(publishCount, 2);
});

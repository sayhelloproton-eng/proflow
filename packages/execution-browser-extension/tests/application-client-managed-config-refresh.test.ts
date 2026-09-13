import assert from "node:assert/strict";
import { test } from "node:test";
import { createApplicationClient } from "../extension/runtime/application-client.ts";

function memoryStorage(initial: Record<string, unknown> = {}) {
	const values: Record<string, unknown> = { ...initial };
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

function bridgeConfig(port: number, tokenChar: string) {
	return {
		endpoint: `http://127.0.0.1:${port}`,
		token: tokenChar.repeat(32),
	};
}

test("missing managed bridge config refreshes from runtime-config without Extension reload", async () => {
	const storage = memoryStorage();
	const runtimeConfigUrl =
		"chrome-extension://abcdefghijklmnopabcdefghijklmnop/runtime-config.json";
	const runtimeConfig = {
		proflowRuntimeBridge: bridgeConfig(47080, "r"),
		proflowLocalToolBridge: bridgeConfig(58858, "l"),
		proflowProvisioningBridge: bridgeConfig(58838, "p"),
		proflowTaskApplication: bridgeConfig(43100, "t"),
		proflowApprovalApplication: bridgeConfig(43100, "a"),
	};
	let fetches = 0;
	const client = createApplicationClient({
		storageLocal: storage,
		runtimeConfigUrl,
		fetchImpl: async (input) => {
			fetches += 1;
			assert.equal(String(input), runtimeConfigUrl);
			return Response.json(runtimeConfig);
		},
	});

	assert.deepEqual(
		await client.provisioningBridgeConfig(),
		runtimeConfig.proflowProvisioningBridge,
	);
	assert.deepEqual(
		await client.localToolBridgeConfig(),
		runtimeConfig.proflowLocalToolBridge,
	);
	assert.deepEqual(await client.bridgeConfig(), runtimeConfig.proflowRuntimeBridge);
	assert.equal(fetches, 1);
	assert.deepEqual(
		storage.values.proflowProvisioningBridge,
		runtimeConfig.proflowProvisioningBridge,
	);
});

test("valid stored managed config wins without refreshing runtime-config", async () => {
	const storedProvisioning = bridgeConfig(58838, "s");
	const storage = memoryStorage({
		proflowProvisioningBridge: storedProvisioning,
	});
	const client = createApplicationClient({
		storageLocal: storage,
		runtimeConfigUrl: "chrome-extension://unused/runtime-config.json",
		fetchImpl: async () => {
			throw new Error("RUNTIME_CONFIG_SHOULD_NOT_BE_FETCHED");
		},
	});

	assert.deepEqual(await client.provisioningBridgeConfig(), storedProvisioning);
});

test("managed config refresh failure remains a nullable config miss", async () => {
	const client = createApplicationClient({
		storageLocal: memoryStorage(),
		runtimeConfigUrl: "chrome-extension://missing/runtime-config.json",
		fetchImpl: async () => {
			throw new Error("RUNTIME_CONFIG_UNAVAILABLE");
		},
	});

	assert.equal(await client.provisioningBridgeConfig(), null);
});

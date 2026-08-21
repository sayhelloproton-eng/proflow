import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const packagesRoot = new URL("../../../packages/", import.meta.url);

test("interactive setup CLIs contain concrete guided operations", async () => {
	const sources = {
		"chatgpt-carrier": "src/cli.ts",
		"dev-tunnel": "src/cli.ts",
		"model-provider-api": "src/cli.ts",
		"model-runtime": "src/cli.ts",
		"execution-browser-extension": "src/configure.ts",
		"agent-controller-dev": "src/cli.ts",
		"agent-product": "src/cli.ts",
		"agent-test-ops": "src/cli.ts",
	} as const;
	for (const [moduleRef, relative] of Object.entries(sources)) {
		const source = await readFile(
			new URL(`${moduleRef}/${relative}`, packagesRoot),
			"utf8",
		);
		assert.match(source, /[\u4e00-\u9fff]/, moduleRef);
		assert.match(source, /process\.stdin\.isTTY/, moduleRef);
		assert.match(source, /--json/, moduleRef);
	}
	assert.match(
		await readFile(new URL("chatgpt-carrier/src/cli.ts", packagesRoot), "utf8"),
		/chatgpt\.com\/gpts\/mine/,
	);
	const tunnel = await readFile(
		new URL("dev-tunnel/src/cli.ts", packagesRoot),
		"utf8",
	);
	for (const action of ["user", "login", "list", "show", "create"])
		assert.match(tunnel, new RegExp(`"${action}"`));
	const extension = await readFile(
		new URL("execution-browser-extension/src/configure.ts", packagesRoot),
		"utf8",
	);
	assert.match(extension, /chrome:\/\/extensions/);
	assert.match(extension, /加载已解压的扩展程序/);
	for (const moduleRef of [
		"agent-controller-dev",
		"agent-product",
		"agent-test-ops",
	]) {
		const source = await readFile(
			new URL(`${moduleRef}/src/cli.ts`, packagesRoot),
			"utf8",
		);
		assert.match(source, /chatgpt\.com\/gpts\/editor/);
		assert.match(source, /Action Schema（动作接口）/);
	}
});

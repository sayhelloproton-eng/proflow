import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
	devTunnelCliPath,
	MANAGED_DEV_TUNNEL_VERSION,
} from "../src/cli-resolver.ts";

test("Dev Tunnel CLI is pinned and resolved inside the dev-tunnel package", async () => {
	assert.equal(MANAGED_DEV_TUNNEL_VERSION, "1.0.2030");
	assert.match(
		devTunnelCliPath(),
		/packages[\\/]dev-tunnel[\\/]\.devtunnel[\\/]1\.0\.2030[\\/]/,
	);
	const source = await readFile(
		new URL("../src/cli-resolver.ts", import.meta.url),
		"utf8",
	);
	assert.doesNotMatch(source, /systemCommand|source:\s*"system"/);
	assert.doesNotMatch(source, /\.proflow[\\/]tools[\\/]devtunnel/);
	assert.match(source, /AbortSignal\.timeout\(DOWNLOAD_TIMEOUT_MS\)/);
});

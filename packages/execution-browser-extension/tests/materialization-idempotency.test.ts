import assert from "node:assert/strict";
import {
	access,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
	behaviorAdapter,
	browserExtensionLoadDir,
} from "../deployment/adapter.ts";

const markerName = ".proflow-materialization.json";

test("browser extension static package materialization is version-idempotent and repairs invalid state", async () => {
	const workspaceRoot = await mkdtemp(
		join(tmpdir(), "proflow-browser-materialize-"),
	);
	const context = { workspaceRoot };
	try {
		await behaviorAdapter.install(context);
		const loadDir = browserExtensionLoadDir(workspaceRoot);
		const markerPath = join(loadDir, markerName);
		const firstMarkerStat = await stat(markerPath);

		await new Promise((resolve) => setTimeout(resolve, 30));
		await behaviorAdapter.install(context);
		const secondMarkerStat = await stat(markerPath);
		assert.equal(secondMarkerStat.mtimeMs, firstMarkerStat.mtimeMs);

		const marker = JSON.parse(await readFile(markerPath, "utf8")) as {
			contract: string;
			moduleVersion: string;
		};
		await writeFile(
			markerPath,
			`${JSON.stringify({ ...marker, moduleVersion: "0.0.0" }, null, 2)}\n`,
		);
		await behaviorAdapter.install(context);
		const refreshedMarker = JSON.parse(await readFile(markerPath, "utf8")) as {
			moduleVersion: string;
		};
		assert.notEqual(refreshedMarker.moduleVersion, "0.0.0");

		const manifestPath = join(loadDir, "manifest.json");
		await rm(manifestPath, { force: true });
		await behaviorAdapter.install(context);
		await access(manifestPath);
	} finally {
		await rm(workspaceRoot, { recursive: true, force: true });
	}
});

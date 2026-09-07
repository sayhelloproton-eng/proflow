import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const helperUrl = new URL("./browser-extension-ui.mjs", import.meta.url);
const swiftUrl = new URL("./browser-extension-ui.swift", import.meta.url);

const expectedCases = [
	"matching-name-id-unique-reload",
	"same-name-wrong-id",
	"name-id-in-different-cards",
	"duplicate-reload",
	"missing-reload",
	"reload-not-pressable",
	"reload-disabled",
	"point-overlaps-toggle",
	"point-overlaps-remove",
	"point-overlaps-details",
	"point-outside-reload",
	"derived-midpoint-and-result-semantics",
	"real-shared-ancestor-legacy-selector-red",
	"real-shared-ancestor-selector-green",
	"extensions-exact-base-url",
	"extensions-trailing-slash-url",
	"extensions-error-query-rejected",
	"extensions-generic-query-rejected",
	"extensions-hash-rejected",
	"extensions-subroute-rejected",
	"non-extensions-url-rejected",
	"error-page-with-load-unpacked-rejected",
	"exact-base-with-load-unpacked-ready",
	"navigation-rechecks-exact-url-and-surface",
	"navigation-rejects-still-noncanonical-url",
	"unknown-url-fails-closed",
	"unknown-url-with-load-unpacked-fails-closed",
];

test("browser reload selector passes the frozen deterministic matrix", () => {
	const result = spawnSync(
		process.execPath,
		[fileURLToPath(helperUrl), "harness-self-test"],
		{
			cwd: fileURLToPath(new URL("../..", import.meta.url)),
			encoding: "utf8",
			timeout: 120_000,
		},
	);
	assert.equal(result.signal, null, result.stderr);
	assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
	for (const name of expectedCases) {
		assert.match(result.stdout, new RegExp(`HARNESS_TEST=${name} PASS`));
	}
	assert.match(result.stdout, /HARNESS_TESTS=27\/27/);
});

test("all Extension-card actions share the URL-first canonical page gate", () => {
	const source = readFileSync(swiftUrl, "utf8");
	assert.match(source, /func currentChromeURL\(\) -> String\?/);
	assert.match(
		source,
		/func isCanonicalExtensionsURL\(_ value: String\) -> Bool/,
	);
	assert.match(source, /EXTENSIONS_URL_AUTHORITY_UNAVAILABLE/);
	assert.match(source, /EXTENSIONS_CANONICAL_URL_NOT_CONFIRMED/);
	assert.match(
		source,
		/func inspectExtensionGeometry\(\) throws \{\s*try ensureExtensionsPage\(\)/s,
	);
	for (const action of [
		"status",
		"screenshot-extensions",
		"reload-at-point",
		"uninstall",
		"install",
	]) {
		const escaped = action.replaceAll("-", "\\-");
		assert.match(
			source,
			new RegExp(`case "${escaped}":[\\s\\S]*?try ensureExtensionsPage\\(\\)`),
		);
	}
});

test("real reload action reports dispatch only and has no coordinate authority fallback", () => {
	const source = readFileSync(swiftUrl, "utf8");
	assert.match(source, /TARGET_RELOAD_CLICK_DISPATCHED/);
	assert.doesNotMatch(source, /RELOADED_AT_FRESH_POINT/);
	assert.doesNotMatch(source, /PROFLOW_BROWSER_RELOAD_[XY]/);
	assert.match(source, /TARGET_RELOAD_UNIQUE=YES/);
	assert.match(source, /TARGET_RELOAD_POINT_CONTROL_OVERLAP=NO/);
});

test("semantic card-binding diagnostic is read-only and shares the canonical page gate", () => {
	const source = readFileSync(swiftUrl, "utf8");
	assert.match(source, /func inspectReloadSemanticBinding\(\) throws/);
	assert.match(
		source,
		/case "inspect-reload-semantic-binding":\s*try ensureExtensionsPage\(\)\s*try inspectReloadSemanticBinding\(\)/s,
	);
	const diagnostic = source.match(
		/func inspectReloadSemanticBinding\(\) throws \{([\s\S]*?)\n\}/,
	)?.[1];
	assert.ok(diagnostic, "diagnostic body must be present");
	assert.doesNotMatch(
		diagnostic,
		/dispatchReloadPress|AXUIElementPerformAction|click\(|CGEvent/,
	);
});

import assert from "node:assert/strict";
import { test } from "node:test";

import {
	PAGE_PERMISSION_BOTTOM_BUTTON_SCAN_LIMIT,
	PAGE_PERMISSION_WATCHDOG_INTERVAL_MS,
	hasBottomActionPermissionControls,
} from "../src/page-permission-watchdog.ts";

test("CP-EXE-BR-44 permission watchdog runs every ten seconds", () => {
	assert.equal(PAGE_PERMISSION_WATCHDOG_INTERVAL_MS, 10_000);
});

test("CP-EXE-BR-44 bottom generic 拒绝/允许 controls trigger a permission refresh", () => {
	assert.equal(
		hasBottomActionPermissionControls(["复制", "编辑", "拒绝", "允许"]),
		true,
	);
});

test("CP-EXE-BR-44 bottom 始终允许/允许一次 variants remain detectable", () => {
	assert.equal(
		hasBottomActionPermissionControls(["拒绝", "始终允许", "允许一次"]),
		true,
	);
});

test("CP-EXE-BR-44 unrelated or incomplete bottom controls do not trigger", () => {
	assert.equal(hasBottomActionPermissionControls(["取消", "继续"]), false);
	assert.equal(hasBottomActionPermissionControls(["允许"]), false);
	assert.equal(hasBottomActionPermissionControls(["拒绝"]), false);
});

test("CP-EXE-BR-44 watchdog is intentionally bounded to the page-bottom button window", () => {
	const noise = Array.from(
		{ length: PAGE_PERMISSION_BOTTOM_BUTTON_SCAN_LIMIT },
		(_, index) => `button-${index}`,
	);
	assert.equal(
		hasBottomActionPermissionControls(["拒绝", "允许", ...noise]),
		false,
	);
});

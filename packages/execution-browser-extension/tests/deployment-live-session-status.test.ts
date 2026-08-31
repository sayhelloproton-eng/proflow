import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyBrowserLiveSetup } from "../deployment/adapter.ts";

const current = {
	kind: "PRESENT" as const,
	identity: {
		extensionId: "a".repeat(32),
		extensionInstanceId: "extension:current",
	},
};

test("Browser deployment status is fail-closed only when a running bridge disproves current live reality", () => {
	assert.deepEqual(
		classifyBrowserLiveSetup({
			baseSetupReady: true,
			evidenceInstanceId: "extension:old",
			bridgeProbe: { kind: "ABSENT" },
		}),
		{ setupReady: true },
	);
	assert.deepEqual(
		classifyBrowserLiveSetup({
			baseSetupReady: true,
			evidenceInstanceId: "extension:old",
			bridgeProbe: { kind: "PRESENT" },
		}),
		{ setupReady: false, issueCode: "EXTENSION_SESSION_OFFLINE" },
	);
	assert.deepEqual(
		classifyBrowserLiveSetup({
			baseSetupReady: true,
			evidenceInstanceId: "extension:old",
			bridgeProbe: current,
		}),
		{
			setupReady: false,
			issueCode: "EXTENSION_SESSION_REVALIDATION_REQUIRED",
		},
	);
	assert.deepEqual(
		classifyBrowserLiveSetup({
			baseSetupReady: true,
			evidenceInstanceId: "extension:current",
			bridgeProbe: current,
		}),
		{ setupReady: true },
	);
});

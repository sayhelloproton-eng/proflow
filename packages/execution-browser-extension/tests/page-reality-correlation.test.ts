import assert from "node:assert/strict";
import { test } from "node:test";

import { pageRealityPermissionCorrelation } from "../extension/runtime/page-reality-correlation.ts";

const permission = {
	tabId: 7,
	contentInstanceId: "content:one",
	url: "https://chatgpt.com/g/g-test/c/worker-test",
	activityKind: "ACTION_PERMISSION",
	blockerFacts: {
		fingerprint: "permission:v1:abc123",
		operationId: "localDev",
	},
};

test("CP-EXE-BR-48 current permission reality carries its own correlation axes", () => {
	assert.deepEqual(pageRealityPermissionCorrelation(undefined, permission), {
		operationRef: "permission:v1:abc123",
		correlationId: "permission:permission:v1:abc123",
		correlationKind: "IDENTITY_MATCH",
		operationId: "localDev",
	});
});

test("CP-EXE-BR-48 released same-page reality inherits the prior permission occurrence", () => {
	assert.deepEqual(
		pageRealityPermissionCorrelation(permission, {
			tabId: 7,
			contentInstanceId: "content:one",
			url: "https://chatgpt.com/g/g-test/c/worker-test",
			activityKind: null,
		}),
		{
			operationRef: "permission:v1:abc123",
			correlationId: "permission:permission:v1:abc123",
			correlationKind: "IDENTITY_MATCH",
			operationId: "localDev",
		},
	);
});

test("CP-EXE-BR-48 permission correlation never crosses content replacement or navigation", () => {
	assert.deepEqual(
		pageRealityPermissionCorrelation(permission, {
			tabId: 7,
			contentInstanceId: "content:two",
			url: "https://chatgpt.com/g/g-test/c/worker-test",
			activityKind: null,
		}),
		{},
	);
	assert.deepEqual(
		pageRealityPermissionCorrelation(permission, {
			tabId: 7,
			contentInstanceId: "content:one",
			url: "https://chatgpt.com/g/g-test/c/other-worker",
			activityKind: null,
		}),
		{},
	);
});

test("CP-EXE-BR-48 non-permission prior reality does not manufacture correlation", () => {
	assert.deepEqual(
		pageRealityPermissionCorrelation(
			{
				tabId: 7,
				contentInstanceId: "content:one",
				url: "https://chatgpt.com/g/g-test/c/worker-test",
				activityKind: "GENERATING",
			},
			{
				tabId: 7,
				contentInstanceId: "content:one",
				url: "https://chatgpt.com/g/g-test/c/worker-test",
				activityKind: null,
			},
		),
		{},
	);
});

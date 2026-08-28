import assert from "node:assert/strict";
import { test } from "node:test";

import { validateProviderBaseUrl } from "../src/setup/interaction.ts";

test("Provider Base URL guidance accepts local HTTP and public HTTPS", () => {
	assert.equal(
		validateProviderBaseUrl("http://192.168.0.108:8080/v1"),
		undefined,
	);
	assert.equal(validateProviderBaseUrl("https://api.deepseek.com"), undefined);
	assert.equal(
		validateProviderBaseUrl("https://openrouter.ai/api/v1"),
		undefined,
	);
});

test("Provider Base URL guidance rejects missing protocol, public HTTP and operation URLs", () => {
	assert.match(validateProviderBaseUrl("api.deepseek.com") ?? "", /http/);
	assert.match(
		validateProviderBaseUrl("http://api.deepseek.com") ?? "",
		/https/,
	);
	assert.match(
		validateProviderBaseUrl("https://api.example.test/v1/chat/completions") ??
			"",
		/Base URL/,
	);
});

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import {
	validateLocalRoleOpenApi,
	validateRoleCarrier,
} from "../src/role-management-client.ts";

const openApi = `openapi: 3.1.0
info:
  title: Role Validation
  version: 1.0.0
paths:
  /actions/getTask:
    get:
      operationId: getTask
      responses:
        '200': { description: ok }
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
security:
  - bearerAuth: []
`;

test("CP-AGT-RUNTIME-11 role carrier validation parses local OpenAPI and proves Gateway health + role-key recognition without a business side effect", async (context) => {
	const credential = "role-secret-that-is-long-enough-for-validation";
	const server = createServer((request, response) => {
		response.setHeader("content-type", "application/json");
		if (request.url === "/health") {
			response.end(JSON.stringify({ status: "UP" }));
			return;
		}
		if (request.url?.startsWith("/actions/getTask")) {
			if (request.headers.authorization !== `Bearer ${credential}`) {
				response.statusCode = 401;
				response.end(JSON.stringify({ error: "AUTHENTICATION_FAILED" }));
				return;
			}
			// A missing synthetic Task is the expected read-only downstream response.
			response.statusCode = 400;
			response.end(JSON.stringify({ error: "TASK_NOT_FOUND" }));
			return;
		}
		response.statusCode = 404;
		response.end(JSON.stringify({ error: "NOT_FOUND" }));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	context.after(
		() => new Promise<void>((resolve) => server.close(() => resolve())),
	);
	const address = server.address();
	if (!address || typeof address === "string")
		assert.fail("missing server port");
	const gatewayUrl = `http://127.0.0.1:${address.port}`;

	assert.deepEqual(validateLocalRoleOpenApi(openApi), []);
	assert.deepEqual(
		await validateRoleCarrier({ gatewayUrl, credential, openApiText: openApi }),
		{ status: "PASS", issues: [] },
	);
	const rejected = await validateRoleCarrier({
		gatewayUrl,
		credential: "wrong-role-key",
		openApiText: openApi,
	});
	assert.equal(rejected.status, "FAIL");
	assert.ok(rejected.issues.includes("GATEWAY_ROLE_KEY_REJECTED"));
	assert.deepEqual(validateLocalRoleOpenApi("not: [valid"), [
		"OPENAPI_PARSE_FAILED",
	]);
});

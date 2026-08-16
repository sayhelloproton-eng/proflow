#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	createRoleManagementClient,
	validateRoleCarrier,
} from "@tomflow/proflow-agent-runtime/role-management-client";

import { materializeAgentPackage } from "./index.ts";

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const metadata = JSON.parse(
	await readFile(new URL("../../package.json", import.meta.url), "utf8"),
) as Record<string, unknown>;
const material = materializeAgentPackage(metadata);
const args = process.argv.slice(2);
const binary = material.packageName.split("/").at(-1);

function help() {
	process.stdout.write(`Usage:
	  ${binary} install
	  ${binary} custom-gpt setup --gateway-url https://public.example
	  ${binary} custom-gpt show-name
	  ${binary} custom-gpt show-description
	  ${binary} custom-gpt show-instructions
	  ${binary} custom-gpt action-schema --gateway-url https://public.example

	  ${binary} role register https://chatgpt.com/g/g-... --platform-host-url http://127.0.0.1:PORT --state-root /absolute/.proflow
	  ${binary} role show --platform-host-url http://127.0.0.1:PORT --state-root /absolute/.proflow
	  ${binary} role list --platform-host-url http://127.0.0.1:PORT --state-root /absolute/.proflow
	  ${binary} role validate --platform-host-url http://127.0.0.1:PORT --state-root /absolute/.proflow --gateway-url https://public.example
	  ${binary} role delete --platform-host-url http://127.0.0.1:PORT --state-root /absolute/.proflow
	  ${binary} role key show --platform-host-url http://127.0.0.1:PORT --state-root /absolute/.proflow
	  ${binary} role key rotate --platform-host-url http://127.0.0.1:PORT --state-root /absolute/.proflow
`);
}

function installSelf() {
	if (args.length !== 1) throw new Error("Usage: install");
	const executable = process.platform === "win32" ? "npx.cmd" : "npx";
	const result = spawnSync(
		executable,
		["--yes", "@tomflow/proflow-platform-cli", "install", material.packageName],
		{ cwd: process.cwd(), env: process.env, stdio: "inherit" },
	);
	if (result.error) throw result.error;
	process.exit(result.status ?? 1);
}

function option(name: string) {
	const index = args.indexOf(name);
	return index >= 0 ? args[index + 1] : undefined;
}

function managementClient() {
	const platformHostUrl =
		option("--platform-host-url") ?? process.env.PROFLOW_PLATFORM_HOST_URL;
	const stateRoot = option("--state-root") ?? process.env.PROFLOW_STATE_ROOT;
	if (!platformHostUrl) throw new Error("PLATFORM_HOST_URL_REQUIRED");
	if (!stateRoot) throw new Error("STATE_ROOT_REQUIRED");
	return createRoleManagementClient({
		platformHostUrl,
		stateRoot: resolve(stateRoot),
	});
}

function roleRefFromCarrierUrl(carrierUrl: string) {
	const url = new URL(carrierUrl);
	if (url.origin !== "https://chatgpt.com" || !url.pathname.startsWith("/g/"))
		throw new Error("INVALID_CUSTOM_GPT_URL");
	const roleRef = decodeURIComponent(url.pathname.slice("/g/".length));
	if (!/^g-[A-Za-z0-9_-]+$/.test(roleRef) || url.pathname !== `/g/${roleRef}`)
		throw new Error("INVALID_CUSTOM_GPT_URL");
	return roleRef;
}

async function runRoleCommand() {
	const command = args[1];
	const client = managementClient();
	let result: unknown;
	if (command === "register") {
		const carrierUrl = args[2];
		if (!carrierUrl || carrierUrl.startsWith("--"))
			throw new Error("CUSTOM_GPT_URL_REQUIRED");
		const roleRef = roleRefFromCarrierUrl(carrierUrl);
		result = await client.invoke("role.register", {
			agentPackageRef: material.packageName,
			registeredPackageVersion: material.version,
			roleRef,
			carrierUrl,
		});
	} else if (command === "list") {
		result = await client.invoke("role.list");
	} else if (command === "validate") {
		const gatewayUrl =
			option("--gateway-url") ?? process.env.PROFLOW_AGENT_GATEWAY_URL;
		if (!gatewayUrl) throw new Error("GATEWAY_URL_REQUIRED");
		const ownerValidation = (await client.invoke("role.validate", {
			agentPackageRef: material.packageName,
			expectedPackageVersion: material.version,
		})) as { status: "PASS" | "FAIL"; role: unknown; issues: string[] };
		const key = (await client.invoke("role.key.show", {
			agentPackageRef: material.packageName,
		})) as { credential: string };
		const openApiText = await readFile(
			new URL(`../../${material.actionSchema}`, import.meta.url),
			"utf8",
		);
		const carrierValidation = await validateRoleCarrier({
			gatewayUrl,
			credential: key.credential,
			openApiText,
		});
		const issues = [...ownerValidation.issues, ...carrierValidation.issues];
		result = {
			status: issues.length === 0 ? "PASS" : "FAIL",
			role: ownerValidation.role,
			checks: {
				owner: ownerValidation.status,
				carrier: carrierValidation.status,
			},
			issues,
			manualChecklist: [
				"Confirm the current Instructions are pasted in Custom GPT Web.",
				"Confirm recommended model/capabilities satisfy the Agent Package requirements.",
				"Confirm the generated Action Schema is pasted in Custom GPT Web.",
			],
		};
	} else if (command === "show" || command === "delete") {
		result = await client.invoke(`role.${command}`, {
			agentPackageRef: material.packageName,
		});
	} else if (command === "key") {
		const keyCommand = args[2];
		if (keyCommand !== "show" && keyCommand !== "rotate")
			throw new Error("UNSUPPORTED_ROLE_KEY_COMMAND");
		result = await client.invoke(`role.key.${keyCommand}`, {
			agentPackageRef: material.packageName,
		});
	} else throw new Error("UNSUPPORTED_ROLE_COMMAND");
	process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
	help();
} else if (args[0] === "install") {
	installSelf();
} else if (args[0] === "role") {
	await runRoleCommand();
} else if (args[0] === "custom-gpt") {
	const command = args[1];
	const agent = metadata.proflowAgent as Record<string, unknown>;
	const gatewayUrl = option("--gateway-url");
	if (
		gatewayUrl &&
		(!gatewayUrl.startsWith("https://") || gatewayUrl.endsWith("/"))
	)
		throw new Error("INVALID_GATEWAY_URL");
	if (command === "show-name")
		process.stdout.write(`${material.displayName}\n`);
	else if (command === "show-description")
		process.stdout.write(`${String(metadata.description)}\n`);
	else if (command === "show-instructions")
		process.stdout.write(`${material.instructions}\n`);
	else if (command === "action-schema") {
		if (!gatewayUrl) throw new Error("GATEWAY_URL_REQUIRED");
		const schema = await readFile(
			new URL(`../../${material.actionSchema}`, import.meta.url),
			"utf8",
		);
		process.stdout.write(
			schema.replace("https://GATEWAY_PUBLIC_HOST", gatewayUrl),
		);
	} else if (command === "setup") {
		if (!gatewayUrl) throw new Error("GATEWAY_URL_REQUIRED");
		process.stdout.write(
			`${JSON.stringify({ packageRoot, packageName: material.packageName, version: material.version, displayName: material.displayName, description: metadata.description, conversationStarters: material.conversationStarters, instructions: material.instructions, knowledgeFiles: material.knowledgeFiles, actionSchema: material.actionSchema, gatewayUrl, carrierProfile: (agent.carrierProfiles as Record<string, unknown>)["custom-gpt"], nextAction: "Configure these fields in the Custom GPT editor, then run this package's role register command with the real https://chatgpt.com/g/g-... URL." }, null, 2)}\n`,
		);
	} else throw new Error("UNSUPPORTED_COMMAND");
} else throw new Error("UNSUPPORTED_COMMAND");

#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

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
	  ${binary} custom-gpt setup --gateway-url https://public.example
	  ${binary} custom-gpt show-name
	  ${binary} custom-gpt show-description
	  ${binary} custom-gpt show-instructions
	  ${binary} custom-gpt action-schema --gateway-url https://public.example
`);
}

if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
	help();
} else if (args[0] !== "custom-gpt") {
	throw new Error("UNSUPPORTED_COMMAND");
} else {
	const command = args[1];
	const agent = metadata.proflowAgent as Record<string, unknown>;
	const gatewayIndex = args.indexOf("--gateway-url");
	const gatewayUrl = gatewayIndex >= 0 ? args[gatewayIndex + 1] : undefined;
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
			`${JSON.stringify({ packageRoot, packageName: material.packageName, version: material.version, displayName: material.displayName, description: metadata.description, conversationStarters: material.conversationStarters, instructions: material.instructions, knowledgeFiles: material.knowledgeFiles, actionSchema: material.actionSchema, gatewayUrl, carrierProfile: (agent.carrierProfiles as Record<string, unknown>)["custom-gpt"], nextAction: "Configure these fields in the Custom GPT editor, then capture the real g-id and register it through Agent Runtime." }, null, 2)}\n`,
		);
	} else throw new Error("UNSUPPORTED_COMMAND");
}

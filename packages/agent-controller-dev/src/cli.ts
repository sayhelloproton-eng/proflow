#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import {
	createRoleManagementClient,
	createWorkspaceRoleSetupClient,
	validateRoleCarrier,
} from "@tomflow/proflow-agent-runtime/role-management-client";
import { behaviorAdapter } from "../deployment/adapter.ts";
import { materializeAgentPackage } from "./index.ts";

function reportFatal(error: unknown) {
	process.stderr.write(
		`✕ 配置失败\n  ${error instanceof Error ? error.message : String(error)}\n`,
	);
	process.exitCode = 1;
}
process.on("uncaughtException", reportFatal);
process.on("unhandledRejection", reportFatal);

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const metadata = JSON.parse(
	await readFile(new URL("../../package.json", import.meta.url), "utf8"),
) as Record<string, unknown>;
const material = materializeAgentPackage(metadata);
const args = process.argv.slice(2);
const workspaceRoot = () =>
	option("--workspace") ?? process.env.PROFLOW_WORKSPACE;
const binary = material.packageName.split("/").at(-1);

function help() {
	process.stdout.write(`Usage:
	  ${binary} custom-gpt setup --workspace /absolute/workspace
	  ${binary} custom-gpt show-name
	  ${binary} custom-gpt show-description
	  ${binary} custom-gpt show-instructions
	  ${binary} custom-gpt action-schema --gateway-url https://public.example
	  ${binary} role register https://chatgpt.com/g/g-... --workspace /absolute/workspace
	  ${binary} role show --platform-host-url http://127.0.0.1:PORT --state-root /absolute/.proflow
	  ${binary} role list --platform-host-url http://127.0.0.1:PORT --state-root /absolute/.proflow
	  ${binary} role validate --platform-host-url http://127.0.0.1:PORT --state-root /absolute/.proflow --gateway-url https://public.example
	  ${binary} role delete --platform-host-url http://127.0.0.1:PORT --state-root /absolute/.proflow
	  ${binary} role key show --platform-host-url http://127.0.0.1:PORT --state-root /absolute/.proflow
	  ${binary} role key rotate --platform-host-url http://127.0.0.1:PORT --state-root /absolute/.proflow
`);
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

function openCustomGptEditor() {
	const url = "https://chatgpt.com/gpts/editor";
	const command =
		process.platform === "darwin"
			? "open"
			: process.platform === "win32"
				? "cmd"
				: "xdg-open";
	const parameters =
		process.platform === "win32" ? ["/c", "start", "", url] : [url];
	const child = spawn(command, parameters, { detached: true, stdio: "ignore" });
	child.unref();
}

function copyToClipboard(value: string) {
	const command =
		process.platform === "darwin"
			? "pbcopy"
			: process.platform === "win32"
				? "clip"
				: "xclip";
	const parameters =
		process.platform === "linux" ? ["-selection", "clipboard"] : [];
	const copied = spawnSync(command, parameters, {
		input: value,
		encoding: "utf8",
	});
	if (copied.status !== 0) throw new Error("CLIPBOARD_UNAVAILABLE");
}

async function runRoleCommand() {
	const command = args[1];
	let result: unknown;
	if (command === "register") {
		const carrierUrl = args[2];
		if (!carrierUrl || carrierUrl.startsWith("--"))
			throw new Error("CUSTOM_GPT_URL_REQUIRED");
		const roleRef = roleRefFromCarrierUrl(carrierUrl);
		const input = {
			agentPackageRef: material.packageName,
			registeredPackageVersion: material.version,
			roleRef,
			carrierUrl,
		};
		const workspace = workspaceRoot();
		result = workspace
			? await (await createWorkspaceRoleSetupClient(workspace)).registerRole(
					input,
				)
			: await managementClient().invoke("role.register", input);
	} else if (command === "list") {
		const client = managementClient();
		result = await client.invoke("role.list");
	} else if (command === "validate") {
		const client = managementClient();
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
		const client = managementClient();
		result = await client.invoke(`role.${command}`, {
			agentPackageRef: material.packageName,
		});
	} else if (command === "key") {
		const client = managementClient();
		const keyCommand = args[2];
		if (keyCommand !== "show" && keyCommand !== "rotate")
			throw new Error("UNSUPPORTED_ROLE_KEY_COMMAND");
		result = await client.invoke(`role.key.${keyCommand}`, {
			agentPackageRef: material.packageName,
		});
	} else throw new Error("UNSUPPORTED_ROLE_COMMAND");
	process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (args.includes("--json")) throw new Error("不支持的选项 --json");
if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
	help();
} else if (args[0] === "setup") {
	const workspace = workspaceRoot() ?? process.cwd();
	const step = args[1]?.startsWith("--") ? undefined : args[1];
	if (step === "02") {
		copyToClipboard(material.instructions);
		process.stdout.write(
			"\n✓ Instructions 已复制到剪贴板\n  请粘贴到 Custom GPT 的 Instructions 字段，保存后运行 setup 03。\n",
		);
		process.exit(0);
	}
	if (step === "03") {
		const client = await createWorkspaceRoleSetupClient(workspace);
		const gatewayUrl = option("--gateway-url") ?? (await client.gatewayUrl());
		if (!gatewayUrl) throw new Error("GATEWAY_NOT_READY");
		const schema = (
			await readFile(
				new URL(`../../${material.actionSchema}`, import.meta.url),
				"utf8",
			)
		).replace("https://GATEWAY_PUBLIC_HOST", gatewayUrl);
		copyToClipboard(schema);
		process.stdout.write(
			"\n✓ Action Schema（动作接口）已复制到剪贴板\n  在 Custom GPT 中新建 Action 并粘贴 Schema。\n",
		);
		if (process.stdin.isTTY) {
			const prompt = createInterface({
				input: process.stdin,
				output: process.stdout,
			});
			try {
				await prompt.question("  Schema 保存后按回车，脚本将复制 Bearer Key… ");
			} finally {
				prompt.close();
			}
			const credential = await client.showRoleCredential({
				agentPackageRef: material.packageName,
				expectedPackageVersion: material.version,
			});
			copyToClipboard(credential.credential);
			process.stdout.write(
				"✓ Bearer Key 已复制到剪贴板（不会显示在终端）\n  选择 Bearer 认证并粘贴 Key，保存后运行 setup 04。\n",
			);
		}
		process.exit(0);
	}
	if (step === "04") {
		const result = behaviorAdapter.status({ workspaceRoot: workspace });
		process.stdout.write(
			result.result.data.setupStatus === "READY"
				? "\n✓ Role 注册和版本验证通过\n"
				: "\n✕ Role 尚未就绪，请从未完成步骤继续。\n",
		);
		if (result.result.data.setupStatus !== "READY") process.exitCode = 1;
		process.exit();
	}
	if (step !== undefined && step !== "01")
		throw new Error(`UNSUPPORTED_SETUP_STEP:${step}`);
	let carrierUrl = option("--carrier-url");
	if (!carrierUrl && !process.stdin.isTTY)
		throw new Error("非交互环境必须提供 --carrier-url");
	if (!carrierUrl) {
		const prompt = createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		try {
			process.stdout.write(
				`\n${material.displayName} · Step 01/04\n\n  1. 浏览器将打开 Custom GPT（自定义 GPT）编辑器。\n  2. 名称：${material.displayName}\n  3. 说明：${String(metadata.description)}\n  4. 先保存 GPT，再复制公开 URL。\n\n`,
			);
			openCustomGptEditor();
			carrierUrl = await prompt.question("◆ Custom GPT URL\n> ");
		} finally {
			prompt.close();
		}
	}
	const roleRef = roleRefFromCarrierUrl(carrierUrl);
	await (await createWorkspaceRoleSetupClient(workspace)).registerRole({
		agentPackageRef: material.packageName,
		registeredPackageVersion: material.version,
		roleRef,
		carrierUrl,
	});
	process.stdout.write(
		"\n✓ Custom GPT Role（角色）已注册\n→ 下一步：setup 02（复制 Instructions）\n",
	);
} else if (args[0] === "verify") {
	const result = behaviorAdapter.status({
		workspaceRoot: workspaceRoot() ?? process.cwd(),
	});
	process.stdout.write(
		result.result.data.setupStatus === "READY"
			? "验证通过。\n"
			: "验证未通过：Role 尚未就绪。\n",
	);
	if (result.result.data.setupStatus !== "READY") process.exitCode = 1;
} else if (args[0] === "role") {
	await runRoleCommand();
} else if (args[0] === "custom-gpt") {
	const command = args[1];
	let gatewayUrl = option("--gateway-url");
	if (!gatewayUrl && workspaceRoot())
		gatewayUrl = await (
			await createWorkspaceRoleSetupClient(workspaceRoot() as string)
		).gatewayUrl();
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
			`${JSON.stringify(
				{
					packageRoot,
					packageName: material.packageName,
					version: material.version,
					displayName: material.displayName,
					description: material.description,
					conversationStarters: material.conversationStarters,
					instructions: material.instructions,
					recommendedModel: material.recommendedModel,
					capabilities: material.capabilities,
					knowledgeBundle: material.knowledgeBundle,
					actionSchema: material.actionSchema,
					gatewayUrl,
					nextAction:
						"Provision this material through execution-browser-extension deployment provisioning; after the live GPT is created, register its real role and complete role-scoped Auth materialization.",
				},
				null,
				2,
			)}\n`,
		);
	} else throw new Error("UNSUPPORTED_COMMAND");
} else throw new Error("UNSUPPORTED_COMMAND");

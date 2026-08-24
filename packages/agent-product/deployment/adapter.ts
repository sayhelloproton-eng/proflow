import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { inspectDurableRoleRegistration } from "@tomflow/proflow-agent-runtime";
import { createWorkspaceRoleSetupClient } from "@tomflow/proflow-agent-runtime/role-management-client";
import { createCustomGptRole } from "@tomflow/proflow-execution-browser-extension/custom-gpt-role";
import {
	type ModuleCommandContext,
	readModuleSharedFacts,
} from "@tomflow/proflow-module-contract";
import { materializeAgentPackage } from "../src/index.ts";

import { descriptor } from "./descriptor.ts";

const base = {
	contract: "deployment.result.v1",
	ok: true,
	status: "SUCCEEDED",
	moduleRef: descriptor.moduleRef,
	moduleVersion: descriptor.moduleVersion,
} as const;
const setupPlan = {
	steps: [
		{
			id: "STEP-AGENT-PRODUCT-01",
			title: "创建 Custom GPT 并注册 Role URL",
			description: "打开编辑器并准备角色资料，保存后登记真实 GPT URL。",
			state: "TODO",
			responsible: "USER",
			execution: {
				interactive: "pnpm exec -- proflow-agent-product setup 01",
				nonInteractive:
					"pnpm exec -- proflow-agent-product setup 01 --carrier-url <url>",
			},
			requiredInputs: [
				{ name: "carrierUrl", description: "Custom GPT URL", sensitive: false },
			],
			verify: "pnpm exec -- proflow-agent-product setup 01",
			successCondition: "Role URL 已写入 Module-owned 注册表",
			humanAction: "保存 GPT 并复制公开 URL。",
		},
		{
			id: "STEP-AGENT-PRODUCT-02",
			title: "配置角色 Instructions",
			description: "复制当前 Product 角色指令。",
			state: "TODO",
			responsible: "USER",
			execution: {
				interactive: "pnpm exec -- proflow-agent-product setup 02",
				nonInteractive:
					"pnpm exec -- proflow-agent-product custom-gpt show-instructions",
			},
			requiredInputs: [],
			verify: "pnpm exec -- proflow-agent-product setup 02",
			successCondition: "当前 Instructions 已保存",
			humanAction: "粘贴剪贴板内容并保存。",
		},
		{
			id: "STEP-AGENT-PRODUCT-03",
			title: "配置 Action Schema 与认证",
			description: "生成 Gateway OpenAPI 并安全复制 Role Key。",
			state: "TODO",
			responsible: "USER",
			execution: {
				interactive: "pnpm exec -- proflow-agent-product setup 03",
				nonInteractive:
					"pnpm exec -- proflow-agent-product setup 03 --gateway-url <url>",
			},
			requiredInputs: [],
			verify: "pnpm exec -- proflow-agent-product role validate",
			successCondition: "Actions 与认证已保存",
			humanAction: "粘贴 Schema 与 Bearer Key 并保存。",
		},
		{
			id: "STEP-AGENT-PRODUCT-04",
			title: "验证 Role 配置",
			description: "检查注册版本和角色状态。",
			state: "TODO",
			responsible: "AI",
			execution: {
				interactive: "pnpm exec -- proflow-agent-product setup 04",
				nonInteractive: "pnpm exec -- proflow-agent-product verify",
			},
			requiredInputs: [],
			verify: "pnpm exec -- proflow-agent-product verify",
			successCondition: "agent-product.setupStatus=READY",
		},
	],
} as const;

function packageRoot(): string {
	return fileURLToPath(
		new URL(
			import.meta.url.includes("/dist/") ? "../../" : "../",
			import.meta.url,
		),
	);
}

function packageMaterial() {
	return materializeAgentPackage(
		JSON.parse(readFileSync(join(packageRoot(), "package.json"), "utf8")),
	);
}

async function gatewayPublicUrl(
	context: ModuleCommandContext,
): Promise<string | undefined> {
	const gateway = await readModuleSharedFacts(context, "agent-gateway");
	const value = gateway?.publicBaseUrl;
	if (typeof value !== "string") return undefined;
	try {
		const parsed = new URL(value);
		return parsed.protocol === "https:" ? parsed.toString() : undefined;
	} catch {
		return undefined;
	}
}

function observeRole(context: ModuleCommandContext) {
	return inspectDurableRoleRegistration({
		proflowRoot: join(context.workspaceRoot, ".proflow"),
		agentPackageRef: descriptor.packageName,
		expectedPackageVersion: descriptor.moduleVersion,
	});
}

const success = () => ({ result: base, observedEffects: [] as string[] });

export const behaviorAdapter = {
	install: success,
	uninstall: success,
	status: (context: ModuleCommandContext) => {
		const reality = observeRole(context);
		const setupStatus =
			reality.status === "READY"
				? ("READY" as const)
				: reality.status === "MISSING" || reality.status === "DRIFT"
					? ("ACTION_REQUIRED" as const)
					: ("FAILED" as const);
		return {
			result: {
				...base,
				data: {
					setupStatus,
					runtimeStatus: "NOT_APPLICABLE" as const,
					...(setupStatus === "READY"
						? {}
						: {
								issues: [
									{
										scope: "SETUP" as const,
										code:
											reality.status === "BROKEN"
												? "ROLE_REGISTRATION_BROKEN"
												: "ROLE_SETUP_REQUIRED",
										message:
											reality.issues.join("；") ||
											"Custom GPT Role 尚未完成注册",
										relatedModuleRefs: [],
										nextCommand: "platform setup --module agent-product",
									},
								],
							}),
				},
			},
			observedEffects: [] as string[],
		};
	},
	setup: async (context: ModuleCommandContext) => {
		const reality = observeRole(context);
		if (reality.status === "READY") {
			return {
				result: {
					...base,
					data: {
						roleRef: reality.role?.roleRef,
						carrierUrl: reality.role?.carrierUrl,
					},
				},
				observedEffects: [] as string[],
			};
		}
		if (reality.status === "DRIFT") {
			return {
				result: {
					...base,
					ok: false as const,
					status: "ACTION_REQUIRED" as const,
					data: setupPlan,
					actionRequired: {
						action: "resolve-custom-gpt-role-drift",
						description:
							"Existing Custom GPT Role is drifted. Automatic setup only creates a new GPT for a missing Role and never edits an existing GPT.",
					},
				},
				observedEffects: [] as string[],
			};
		}
		if (reality.status === "MISSING") {
			const gatewayUrl = await gatewayPublicUrl(context);
			if (!gatewayUrl) {
				return {
					result: {
						...base,
						ok: false as const,
						status: "FAILED" as const,
						error: {
							code: "SETUP_FAILED" as const,
							message:
								"agent-gateway publicBaseUrl is unavailable for Custom GPT provisioning",
							retryable: true,
						},
					},
					observedEffects: [] as string[],
				};
			}
			try {
				const roleClient = await createWorkspaceRoleSetupClient(
					context.workspaceRoot,
				);
				const result = await createCustomGptRole(
					{
						workspaceRoot: context.workspaceRoot,
						packageRoot: packageRoot(),
						stagingRoot: join(
							context.workspaceRoot,
							".proflow",
							"runtime",
							"custom-gpt-staging",
							descriptor.moduleRef,
						),
						gatewayUrl,
						material: packageMaterial(),
					},
					{
						roleRegistry: {
							saveRole: (input) => roleClient.registerRole(input),
							inspectRole: (input) => roleClient.inspectRole(input),
						},
					},
				);
				return {
					result: {
						...base,
						data: {
							provisioningStatus: result.status,
							roleRef: result.gptId,
							carrierUrl: result.carrierUrl,
						},
					},
					observedEffects: [
						"Create the declared Private Custom GPT and register its workspace Role",
					],
				};
			} catch (error) {
				return {
					result: {
						...base,
						ok: false as const,
						status: "FAILED" as const,
						error: {
							code: "SETUP_FAILED" as const,
							message:
								error instanceof Error
									? error.message
									: "Custom GPT provisioning failed",
							retryable: true,
						},
					},
					observedEffects: [] as string[],
				};
			}
		}
		return {
			result: {
				...base,
				ok: false as const,
				status: "FAILED" as const,
				error: {
					code: "SETUP_FAILED" as const,
					message: `Role registration store is ${reality.status.toLowerCase()}: ${reality.issues.join(", ")}`,
					retryable: false,
				},
			},
			observedEffects: [] as string[],
		};
	},
	docs: () => ({
		result: {
			...base,
			data: {
				docs: readFileSync(
					new URL(
						import.meta.url.includes("/dist/") ? "../../DOCS.md" : "../DOCS.md",
						import.meta.url,
					),
					"utf8",
				),
			},
		},
		observedEffects: [] as string[],
	}),
	start: success,
	stop: success,
} as const;

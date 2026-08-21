import { readFileSync } from "node:fs";
import { join } from "node:path";

import { inspectDurableRoleRegistration } from "@tomflow/proflow-agent-runtime";
import type { ModuleCommandContext } from "@tomflow/proflow-module-contract";

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
			id: "STEP-AGENT-TEST-OPS-01",
			title: "创建 Custom GPT 并注册 Role URL",
			description: "打开编辑器并准备角色资料，保存后登记真实 GPT URL。",
			state: "TODO",
			responsible: "USER",
			execution: {
				interactive: "pnpm exec -- proflow-agent-test-ops setup 01",
				nonInteractive:
					"pnpm exec -- proflow-agent-test-ops setup 01 --carrier-url <url>",
			},
			requiredInputs: [
				{ name: "carrierUrl", description: "Custom GPT URL", sensitive: false },
			],
			verify: "pnpm exec -- proflow-agent-test-ops setup 01",
			successCondition: "Role URL 已写入 Module-owned 注册表",
			humanAction: "保存 GPT 并复制公开 URL。",
		},
		{
			id: "STEP-AGENT-TEST-OPS-02",
			title: "配置角色 Instructions",
			description: "复制当前 Test/Ops 角色指令。",
			state: "TODO",
			responsible: "USER",
			execution: {
				interactive: "pnpm exec -- proflow-agent-test-ops setup 02",
				nonInteractive:
					"pnpm exec -- proflow-agent-test-ops custom-gpt show-instructions",
			},
			requiredInputs: [],
			verify: "pnpm exec -- proflow-agent-test-ops setup 02",
			successCondition: "当前 Instructions 已保存",
			humanAction: "粘贴剪贴板内容并保存。",
		},
		{
			id: "STEP-AGENT-TEST-OPS-03",
			title: "配置 Action Schema 与认证",
			description: "生成 Gateway OpenAPI 并安全复制 Role Key。",
			state: "TODO",
			responsible: "USER",
			execution: {
				interactive: "pnpm exec -- proflow-agent-test-ops setup 03",
				nonInteractive:
					"pnpm exec -- proflow-agent-test-ops setup 03 --gateway-url <url>",
			},
			requiredInputs: [],
			verify: "pnpm exec -- proflow-agent-test-ops role validate",
			successCondition: "Actions 与认证已保存",
			humanAction: "粘贴 Schema 与 Bearer Key 并保存。",
		},
		{
			id: "STEP-AGENT-TEST-OPS-04",
			title: "验证 Role 配置",
			description: "检查注册版本和角色状态。",
			state: "TODO",
			responsible: "AI",
			execution: {
				interactive: "pnpm exec -- proflow-agent-test-ops setup 04",
				nonInteractive: "pnpm exec -- proflow-agent-test-ops verify",
			},
			requiredInputs: [],
			verify: "pnpm exec -- proflow-agent-test-ops verify",
			successCondition: "agent-test-ops.setupStatus=READY",
		},
	],
} as const;

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
				data: { setupStatus, runtimeStatus: "NOT_APPLICABLE" as const },
			},
			observedEffects: [] as string[],
		};
	},
	setup: (context: ModuleCommandContext) => {
		const reality = observeRole(context);
		if (reality.status === "READY") {
			return {
				result: { ...base, data: { roleRef: reality.role?.roleRef } },
				observedEffects: [] as string[],
			};
		}
		if (reality.status === "MISSING" || reality.status === "DRIFT") {
			const action =
				reality.status === "MISSING"
					? "materialize-custom-gpt"
					: "refresh-custom-gpt-role-registration";
			return {
				result: {
					...base,
					ok: false as const,
					status: "ACTION_REQUIRED" as const,
					data: setupPlan,
					actionRequired: {
						action,
						description: `${descriptor.packageName}@${descriptor.moduleVersion} Role is ${reality.status.toLowerCase()}: ${reality.issues.join(", ")}. Run ${descriptor.packageName.replace("@tomflow/", "")} custom-gpt setup --workspace ${JSON.stringify(context.workspaceRoot)}; create/update the real Custom GPT; then run ${descriptor.packageName.replace("@tomflow/", "")} role register <gpt-url> --workspace ${JSON.stringify(context.workspaceRoot)} and rerun platform setup.`,
					},
				},
				observedEffects: [] as string[],
			};
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

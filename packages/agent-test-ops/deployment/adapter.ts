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
		result: { ...base, data: descriptor.documentation },
		observedEffects: [] as string[],
	}),
	start: success,
	stop: success,
} as const;

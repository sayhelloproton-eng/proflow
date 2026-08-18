import { inspectDurableRoleRegistration } from "@tomflow/proflow-agent-runtime";

import { descriptor } from "./descriptor.ts";

const base = {
	contract: "deployment.result.v1",
	ok: true,
	status: "SUCCEEDED",
	moduleRef: descriptor.moduleRef,
	moduleVersion: descriptor.moduleVersion,
} as const;

function createBehaviorAdapter(stateRoot?: string) {
	const currentReality = () => {
		if (!stateRoot) {
			return {
				...base,
				ok: false as const,
				status: "ACTION_REQUIRED" as const,
				actionRequired: {
					action: "configure-platform-host-state-root",
					description:
						"Platform Host stateRoot is required to inspect durable Role registration",
				},
			};
		}
		const reality = inspectDurableRoleRegistration({
			proflowRoot: stateRoot,
			agentPackageRef: descriptor.packageName,
			expectedPackageVersion: descriptor.moduleVersion,
		});
		if (reality.status === "READY") {
			return { ...base, data: { roleRef: reality.role?.roleRef } };
		}
		const action =
			reality.status === "MISSING"
				? "materialize-custom-gpt"
				: reality.status === "DRIFT"
					? "refresh-custom-gpt-role-registration"
					: "repair-custom-gpt-role-store";
		return {
			...base,
			ok: false as const,
			status: "ACTION_REQUIRED" as const,
			actionRequired: {
				action,
				description: `${descriptor.packageName}@${descriptor.moduleVersion} Role is ${reality.status.toLowerCase()}: ${reality.issues.join(", ")}. Materialize/register the real Custom GPT Role, then rerun platform preflight --intent start.`,
			},
		};
	};
	return {
		describe: () => ({ result: base, observedEffects: [] }),
		preflight: () => ({ result: currentReality(), observedEffects: [] }),
		status: () => ({ result: currentReality(), observedEffects: [] }),
		verify: () => ({
			result: {
				...base,
				checks: [
					{
						id: "agent-package-material",
						status: "PASS" as const,
						message: "Static package material is present",
					},
				],
			},
			observedEffects: [],
		}),
		doctor: () => ({ result: currentReality(), observedEffects: [] }),
	};
}

export const behaviorAdapter = createBehaviorAdapter();

export function createProductionBinding(input: {
	configByModuleRef: ReadonlyMap<string, Record<string, string>>;
}) {
	const stateRoot = input.configByModuleRef.get("platform-host")?.stateRoot;
	if (!stateRoot) return undefined;
	return { behaviorAdapter: createBehaviorAdapter(stateRoot) };
}

import type { ModelRuntimeService } from "../src/service.ts";
import { descriptor } from "./descriptor.ts";

type LiveVerification = () => Promise<{ ok: boolean; message: string }>;

const success = (data?: unknown) => ({
	contract: "deployment.result.v1" as const,
	ok: true,
	status: "SUCCEEDED" as const,
	moduleRef: descriptor.moduleRef,
	moduleVersion: descriptor.moduleVersion,
	...(data === undefined ? {} : { data }),
});

const actionRequired = (action: string, description: string) => ({
	contract: "deployment.result.v1" as const,
	ok: false,
	status: "ACTION_REQUIRED" as const,
	moduleRef: descriptor.moduleRef,
	moduleVersion: descriptor.moduleVersion,
	actionRequired: { action, description },
});

export function createBehaviorAdapter(input?: {
	service: ModelRuntimeService;
	verifyProvider: LiveVerification;
}) {
	return {
		describe: () => ({
			result: success({ publicApi: ["infer", "getRuntimeStatus"] }),
			observedEffects: [],
		}),
		preflight: () => ({
			result: input
				? success()
				: actionRequired(
						"configure-provider",
						"Bind a runtime service and real provider verifier",
					),
			observedEffects: [],
		}),
		status: () => {
			const inspection = input ? input.service.inspect() : undefined;
			if (!inspection)
				return {
					result: actionRequired(
						"configure-provider",
						"No Model Runtime service is bound",
					),
					observedEffects: [],
				};
			const dependency = inspection.dependency;
			const ready =
				inspection.readiness === "READY" &&
				dependency.fast === "READY" &&
				dependency.reason === "READY";
			return {
				result: {
					...(ready
						? success()
						: actionRequired(
								"repair-model-runtime",
								"Model Runtime process is not fully READY (roles/lane/provider unavailable)",
							)),
					checks: [
						{
							id: "runtime-status-fresh",
							status:
								inspection.readiness === "READY"
									? ("PASS" as const)
									: ("FAIL" as const),
							message: `Model Runtime readiness is ${inspection.readiness}`,
						},
						{
							id: "fast-role-available",
							status:
								dependency.fast === "READY"
									? ("PASS" as const)
									: ("FAIL" as const),
							message: `FAST role is ${dependency.fast}`,
						},
						{
							id: "reason-role-available",
							status:
								dependency.reason === "READY"
									? ("PASS" as const)
									: ("FAIL" as const),
							message: `REASON role is ${dependency.reason}`,
						},
					],
				},
				observedEffects: [],
			};
		},
		verify: async () => {
			if (!input)
				return {
					result: actionRequired(
						"configure-provider",
						"Real provider verification is required",
					),
					observedEffects: [],
				};
			const proof = await input.verifyProvider();
			return {
				result: proof.ok
					? {
							...success(),
							checks: [
								{
									id: "real-provider-capabilities",
									status: "PASS" as const,
									message: proof.message,
								},
							],
						}
					: {
							...actionRequired("repair-provider", proof.message),
							checks: [
								{
									id: "real-provider-capabilities",
									status: "FAIL" as const,
									message: proof.message,
								},
							],
						},
				observedEffects: ["Calls the configured model provider API"],
			};
		},
		doctor: () => ({
			result: input
				? {
						...success(),
						checks: [
							{
								id: "provider-diagnostics",
								status: "PASS" as const,
								message: "Provider verifier and runtime service are bound",
							},
						],
					}
				: actionRequired(
						"configure-provider",
						"Provider URL, role models, and optional credential reference are required",
					),
			observedEffects: [],
		}),
		start: async () => ({
			result: input
				? success(await input.service.start())
				: actionRequired(
						"configure-provider",
						"Cannot start without a bound runtime",
					),
			observedEffects: input
				? ["Runs the Model Runtime HTTP service process"]
				: [],
		}),
		stop: async () => {
			if (input) await input.service.stop();
			return {
				result: input
					? success()
					: actionRequired("configure-provider", "No bound runtime to stop"),
				observedEffects: input
					? ["Runs the Model Runtime HTTP service process"]
					: [],
			};
		},
		restart: async () => {
			if (!input)
				return {
					result: actionRequired(
						"configure-provider",
						"No bound runtime to restart",
					),
					observedEffects: [],
				};
			await input.service.stop();
			const address = await input.service.start();
			return {
				result: success(address),
				observedEffects: ["Runs the Model Runtime HTTP service process"],
			};
		},
	};
}

export const behaviorAdapter = createBehaviorAdapter();

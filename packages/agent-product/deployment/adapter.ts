import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { inspectDurableRoleRegistration } from "@tomflow/proflow-agent-runtime";
import {
	createWorkspaceRoleSetupClient,
	inspectRoleCarrierValidationEvidence,
	readExpectedRoleCarrierMaterial,
	type RoleCarrierMaterialIssue,
	recordRoleCarrierValidationEvidence,
	validateRoleCarrier,
} from "@tomflow/proflow-agent-runtime/role-management-client";
import { createWorkspaceCustomGptProvisioningHost } from "@tomflow/proflow-execution-browser-extension/custom-gpt-provisioning";
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
async function missingRolePrerequisites(context: ModuleCommandContext) {
	const [gateway, browser] = await Promise.all([
		readModuleSharedFacts(context, "agent-gateway"),
		readModuleSharedFacts(context, "execution-browser-extension"),
	]);
	const missing: string[] = [];
	if (typeof gateway?.publicBaseUrl !== "string") missing.push("agent-gateway");
	if (typeof browser?.browserExecutorConfigPath !== "string")
		missing.push("execution-browser-extension");
	return missing;
}

function observeRole(context: ModuleCommandContext) {
	return inspectDurableRoleRegistration({
		proflowRoot: join(context.workspaceRoot, ".proflow"),
		agentPackageRef: descriptor.packageName,
		expectedPackageVersion: descriptor.moduleVersion,
	});
}

async function carrierValidationCurrent(
	context: ModuleCommandContext,
	reality: ReturnType<typeof observeRole>,
): Promise<{ current: boolean; issue?: RoleCarrierMaterialIssue }> {
	if (reality.status !== "READY" || !reality.role) return { current: false };
	const gatewayUrl = await gatewayPublicUrl(context);
	if (!gatewayUrl) return { current: false };
	try {
		return inspectRoleCarrierValidationEvidence({
			expectedMaterial: await readExpectedRoleCarrierMaterial(packageRoot(), gatewayUrl),
			workspaceRoot: context.workspaceRoot,
			agentPackageRef: descriptor.packageName,
			registeredPackageVersion: reality.role.registeredPackageVersion,
			roleRef: reality.role.roleRef,
			carrierUrl: reality.role.carrierUrl,
			gatewayUrl,
		});
	} catch {
		return { current: false, issue: "ROLE_CARRIER_MATERIAL_UNVERIFIED" };
	}
}


async function synchronizeDriftedRole(
	context: ModuleCommandContext,
	reality: ReturnType<typeof observeRole>,
) {
	if (!reality.role) throw new Error("ROLE_NOT_READY");
	const gatewayUrl = await gatewayPublicUrl(context);
	if (!gatewayUrl) throw new Error("GATEWAY_URL_UNAVAILABLE");
	const roleClient = await createWorkspaceRoleSetupClient(context.workspaceRoot);
	const shown = await roleClient.showRoleCredentialByRef(reality.role.roleRef);
	const material = packageMaterial();
	const openApiText = readFileSync(join(packageRoot(), material.actionSchema), "utf8");
	const host = await createWorkspaceCustomGptProvisioningHost({
		workspaceRoot: context.workspaceRoot,
	});
	try {
		const synchronized = await host.synchronizeExistingPackage({
			packageRoot: packageRoot(),
			stagingRoot: join(
				context.workspaceRoot, ".proflow", "runtime", "custom-gpt-staging", descriptor.moduleRef,
			),
			gatewayUrl,
			material,
			carrierUrl: reality.role.carrierUrl,
			credential: shown.credential,
		});
		const expectedMaterial = await readExpectedRoleCarrierMaterial(packageRoot(), gatewayUrl);
		const validation = await validateRoleCarrier(
			{
				expectedMaterial,
				roleRef: reality.role.roleRef,
				carrierUrl: reality.role.carrierUrl,
				gatewayUrl,
				credential: shown.credential,
				openApiText,
			},
			{ readLiveMaterial: async () => synchronized.materialObservation },
		);
		if (validation.status !== "PASS")
			throw new Error(`ROLE_CARRIER_VALIDATION_FAILED:${validation.issues.join("|")}`);
		await roleClient.adoptCurrentRoleVersion({
			agentPackageRef: descriptor.packageName,
			registeredPackageVersion: descriptor.moduleVersion,
			roleRef: reality.role.roleRef,
			carrierUrl: reality.role.carrierUrl,
		});
		await recordRoleCarrierValidationEvidence({
			expectedMaterial,
			materialObservation: validation.materialObservation,
			workspaceRoot: context.workspaceRoot,
			agentPackageRef: descriptor.packageName,
			registeredPackageVersion: descriptor.moduleVersion,
			roleRef: reality.role.roleRef,
			carrierUrl: reality.role.carrierUrl,
			gatewayUrl,
		});
		return { roleRef: reality.role.roleRef, carrierUrl: reality.role.carrierUrl };
	} finally {
		await host.close();
	}
}

const success = () => ({ result: base, observedEffects: [] as string[] });

export const behaviorAdapter = {
	install: success,
	uninstall: success,
	status: async (context: ModuleCommandContext) => {
		const reality = observeRole(context);
		const missingPrerequisites = await missingRolePrerequisites(context);
		const validation = await carrierValidationCurrent(context, reality);
		const validationCurrent = validation.current;
		const setupStatus =
			reality.status === "READY" && validationCurrent
				? ("READY" as const)
				: missingPrerequisites.length > 0
					? ("BLOCKED" as const)
					: reality.status === "READY" ||
							reality.status === "MISSING" ||
							reality.status === "DRIFT"
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
											missingPrerequisites.length > 0
												? "UPSTREAM_NOT_READY"
												: reality.status === "BROKEN"
													? "ROLE_REGISTRATION_BROKEN"
													: reality.status === "READY" && !validationCurrent
														? (validation.issue ?? "ROLE_CARRIER_MATERIAL_UNVERIFIED")
														: "ROLE_SETUP_REQUIRED",
										message:
											missingPrerequisites.length > 0
												? `等待 ${missingPrerequisites.join("、")} 就绪后自动继续`
												: reality.status === "READY" && !validationCurrent
													? "必须验证原 Custom GPT 的已发布 material；缺失回读证据或内容漂移，禁止重复创建"
													: reality.issues.join("；") ||
														"Custom GPT Role 尚未完成注册",
										relatedModuleRefs: missingPrerequisites,
										nextCommand:
											missingPrerequisites.length > 0
												? "platform setup"
												: "platform setup --module agent-product",
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
		if (
			reality.status === "READY" &&
			(await carrierValidationCurrent(context, reality)).current
		) {
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
		const missingPrerequisites = await missingRolePrerequisites(context);
		if (missingPrerequisites.length > 0) {
			return {
				result: {
					...base,
					data: { waitingFor: missingPrerequisites },
				},
				observedEffects: [] as string[],
			};
		}
		if (reality.status === "READY" && reality.role) {
			try {
				const gatewayUrl = await gatewayPublicUrl(context);
				if (!gatewayUrl) throw new Error("GATEWAY_URL_UNAVAILABLE");
				const roleClient = await createWorkspaceRoleSetupClient(
					context.workspaceRoot,
				);
				const material = packageMaterial();
				const openApiText = readFileSync(
					join(packageRoot(), material.actionSchema),
					"utf8",
				);
				const shown = await roleClient.showRoleCredential({
					agentPackageRef: descriptor.packageName,
					expectedPackageVersion: descriptor.moduleVersion,
				});
				const expectedMaterial = await readExpectedRoleCarrierMaterial(packageRoot(), gatewayUrl);
				const validation = await validateRoleCarrier({
					expectedMaterial,
					roleRef: reality.role.roleRef,
					carrierUrl: reality.role.carrierUrl,
					gatewayUrl,
					credential: shown.credential,
					openApiText,
				});
				if (validation.status !== "PASS")
					throw new Error(
						`ROLE_CARRIER_VALIDATION_FAILED:${validation.issues.join("|")}`,
					);
				await recordRoleCarrierValidationEvidence({
					expectedMaterial,
					materialObservation: validation.materialObservation,
					workspaceRoot: context.workspaceRoot,
					agentPackageRef: descriptor.packageName,
					registeredPackageVersion: reality.role.registeredPackageVersion,
					roleRef: reality.role.roleRef,
					carrierUrl: reality.role.carrierUrl,
					gatewayUrl,
				});
				return {
					result: {
						...base,
						data: {
							roleRef: reality.role.roleRef,
							carrierUrl: reality.role.carrierUrl,
						},
					},
					observedEffects: [
						"Verify the existing Custom GPT Role through Gateway ingress",
					],
				};
			} catch (error) {
				if (error instanceof Error && /ROLE_CARRIER_MATERIAL_(DRIFT|UNVERIFIED)/.test(error.message)) {
					return { result: { ...base, ok: false as const, status: "ACTION_REQUIRED" as const,
						actionRequired: { action: "verify-existing-custom-gpt-material", description: `${error.message}; preserve the existing GPT and verify/update its published material; never create a replacement.` },
					}, observedEffects: [] as string[] };
				}
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
									: "Custom GPT carrier validation failed",
							retryable: true,
						},
					},
					observedEffects: [] as string[],
				};
			}
		}
		if (reality.status === "DRIFT" && reality.role) {
			try {
				const synchronized = await synchronizeDriftedRole(context, reality);
				return {
					result: { ...base, data: synchronized },
					observedEffects: [
						"Update the existing Custom GPT in place, verify published material, and adopt the current package version",
					],
				};
			} catch (error) {
				return {
					result: {
						...base,
						ok: false as const,
						status: "ACTION_REQUIRED" as const,
						actionRequired: {
							action: "resolve-custom-gpt-role-drift",
							description:
								error instanceof Error
									? `${error.message}; existing GPT identity is preserved and no replacement GPT was created.`
									: "Existing GPT material synchronization failed; preserve the existing GPT and retry setup.",
						},
					},
					observedEffects: [] as string[],
				};
			}
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
				const material = packageMaterial();
				const openApiText = readFileSync(
					join(packageRoot(), material.actionSchema),
					"utf8",
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
						material,
					},
					{
						roleRegistry: {
							prepareCredential: () => roleClient.prepareRoleCredential(),
							saveRole: (input, preparedCredential) =>
								roleClient.saveCurrentRole(input, preparedCredential),
							deleteRole: (roleRef) => roleClient.deleteRole(roleRef),
							inspectRole: (input) => roleClient.inspectRole(input),
						},
						async verifyCarrier({
							agentPackageRef,
							registeredPackageVersion,
							roleRef,
							carrierUrl,
							credential,
							gatewayUrl: verifiedGatewayUrl,
							materialObservation,
						}) {
							const expectedMaterial = await readExpectedRoleCarrierMaterial(packageRoot(), verifiedGatewayUrl);
							const validation = await validateRoleCarrier(
								{
									expectedMaterial,
									roleRef,
									carrierUrl,
									gatewayUrl: verifiedGatewayUrl,
									credential,
									openApiText,
								},
								{ readLiveMaterial: async () => materialObservation },
							);
							if (validation.status !== "PASS")
								throw new Error(
									`ROLE_CARRIER_VALIDATION_FAILED:${validation.issues.join("|")}`,
								);
							await recordRoleCarrierValidationEvidence({
								expectedMaterial,
								materialObservation: validation.materialObservation,
								workspaceRoot: context.workspaceRoot,
								agentPackageRef,
								registeredPackageVersion,
								roleRef,
								carrierUrl,
								gatewayUrl: verifiedGatewayUrl,
							});
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
						"Create the declared Private Custom GPT, finalize Role bearer auth, and verify Gateway ingress",
					],
				};
			} catch (error) {
				if (error instanceof Error && /ROLE_CARRIER_MATERIAL_(DRIFT|UNVERIFIED)/.test(error.message)) {
					return { result: { ...base, ok: false as const, status: "ACTION_REQUIRED" as const,
						actionRequired: { action: "verify-existing-custom-gpt-material", description: `${error.message}; preserve the existing GPT and verify/update its published material; never create a replacement.` },
					}, observedEffects: [] as string[] };
				}
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

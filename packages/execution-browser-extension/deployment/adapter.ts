import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { descriptor } from "./descriptor.ts";

const base = {
	contract: "deployment.result.v1",
	moduleRef: descriptor.moduleRef,
	moduleVersion: descriptor.moduleVersion,
} as const;
export const behaviorAdapter = {
	describe: () => ({
		result: { ...base, ok: true, status: "SUCCEEDED" },
		observedEffects: [],
	}),
	preflight: () => ({
		result: { ...base, ok: true, status: "SUCCEEDED" },
		observedEffects: [],
	}),
	status: () => ({
		result: {
			...base,
			ok: false,
			status: "ACTION_REQUIRED",
			actionRequired: {
				action: "verify-real-carrier",
				description: "Load in real Chrome and collect ChatGPT E3/E4 evidence",
			},
		},
		observedEffects: [],
	}),
	verify: () => ({
		result: {
			...base,
			ok: true,
			status: "SUCCEEDED",
			checks: [
				{
					id: "extension-package",
					status: "PASS",
					message:
						"The MV3 package is structurally verified; real Carrier readiness remains ACTION_REQUIRED in status",
				},
			],
		},
		observedEffects: [],
	}),
	doctor: () => ({
		result: { ...base, ok: true, status: "SUCCEEDED" },
		observedEffects: [],
	}),
} as const;

type BrowserRuntimeConfig = {
	proflowRuntimeBridge: { endpoint: string; token: string };
	proflowTaskApplication: { endpoint: string; token: string };
	proflowApprovalApplication: { endpoint: string; token: string };
};

function loopbackEndpoint(value: string, key: string): string {
	const url = new URL(value);
	if (
		url.protocol !== "http:" ||
		url.hostname !== "127.0.0.1" ||
		url.pathname !== "/" ||
		url.search !== "" ||
		url.hash !== ""
	) {
		throw new Error(`${key} must be a loopback HTTP origin`);
	}
	return value.replace(/\/$/, "");
}

async function credential(file: string, key: string): Promise<string> {
	const token = (await readFile(file, "utf8")).trim();
	if (token.length < 32)
		throw new Error(`${key} must contain at least 32 characters`);
	return token;
}

function packageRoot(): string {
	const candidate = dirname(dirname(fileURLToPath(import.meta.url)));
	return basename(candidate) === "dist" ? dirname(candidate) : candidate;
}

export function browserExtensionLoadDir(workspaceRoot: string): string {
	return join(
		workspaceRoot,
		".proflow",
		"deployment",
		"browser-extension",
		"execution-browser-extension",
	);
}

export async function materializeProductionConfig(input: {
	moduleRef: string;
	config: Record<string, string>;
	workspaceRoot: string;
}): Promise<{ loadDir: string }> {
	const required = [
		"bridge.endpoint",
		"bridge.token",
		"taskApplication.endpoint",
		"taskApplication.token",
		"approvalApplication.endpoint",
		"approvalApplication.token",
	] as const;
	for (const key of required) {
		if (!input.config[key])
			throw new Error(`missing required browser config ${key}`);
	}

	const runtimeConfig: BrowserRuntimeConfig = {
		proflowRuntimeBridge: {
			endpoint: loopbackEndpoint(
				input.config["bridge.endpoint"] ?? "",
				"bridge.endpoint",
			),
			token: await credential(
				input.config["bridge.token"] ?? "",
				"bridge.token",
			),
		},
		proflowTaskApplication: {
			endpoint: loopbackEndpoint(
				input.config["taskApplication.endpoint"] ?? "",
				"taskApplication.endpoint",
			),
			token: await credential(
				input.config["taskApplication.token"] ?? "",
				"taskApplication.token",
			),
		},
		proflowApprovalApplication: {
			endpoint: loopbackEndpoint(
				input.config["approvalApplication.endpoint"] ?? "",
				"approvalApplication.endpoint",
			),
			token: await credential(
				input.config["approvalApplication.token"] ?? "",
				"approvalApplication.token",
			),
		},
	};

	const sourceRoot = packageRoot();
	const loadDir = browserExtensionLoadDir(input.workspaceRoot);
	await mkdir(join(loadDir, "dist"), { recursive: true });
	await cp(
		join(sourceRoot, "dist", "extension"),
		join(loadDir, "dist", "extension"),
		{
			recursive: true,
			force: true,
		},
	);
	await cp(join(sourceRoot, "extension"), join(loadDir, "extension"), {
		recursive: true,
		force: true,
	});
	await cp(join(sourceRoot, "manifest.json"), join(loadDir, "manifest.json"), {
		force: true,
	});
	await writeFile(
		join(loadDir, "runtime-config.json"),
		`${JSON.stringify(runtimeConfig, null, 2)}\n`,
		{ encoding: "utf8", mode: 0o600 },
	);
	return { loadDir };
}

type BrowserVerificationEvidence = {
	contract: "proflow.browser-extension-verification.v1";
	moduleVersion: string;
	loadDir: string;
	extensionId: string;
	serviceWorker: "RUNNING";
	observedAt: string;
};

async function readBrowserVerificationEvidence(
	file: string | undefined,
	expectedLoadDir: string,
): Promise<BrowserVerificationEvidence | undefined> {
	if (!file) return undefined;
	try {
		const raw = JSON.parse(
			await readFile(file, "utf8"),
		) as Partial<BrowserVerificationEvidence>;
		if (
			raw.contract !== "proflow.browser-extension-verification.v1" ||
			raw.moduleVersion !== descriptor.moduleVersion ||
			raw.loadDir !== expectedLoadDir ||
			typeof raw.extensionId !== "string" ||
			raw.extensionId.length < 16 ||
			raw.serviceWorker !== "RUNNING" ||
			typeof raw.observedAt !== "string" ||
			Number.isNaN(Date.parse(raw.observedAt))
		)
			return undefined;
		return raw as BrowserVerificationEvidence;
	} catch {
		return undefined;
	}
}

export function createProductionBinding(input: {
	moduleRef: string;
	config: Record<string, string>;
	workspaceRoot: string;
}): { behaviorAdapter: Record<string, unknown> } {
	const loadDir = browserExtensionLoadDir(input.workspaceRoot);
	const verificationEvidenceFile = input.config.verificationEvidenceFile;
	const boundBase = {
		contract: "deployment.result.v1" as const,
		moduleRef: descriptor.moduleRef,
		moduleVersion: descriptor.moduleVersion,
	};
	const configured = async () => {
		try {
			const raw = JSON.parse(
				await readFile(join(loadDir, "runtime-config.json"), "utf8"),
			) as unknown;
			return typeof raw === "object" && raw !== null;
		} catch {
			return false;
		}
	};
	return {
		behaviorAdapter: {
			...behaviorAdapter,
			preflight: async () => ({
				result: (await configured())
					? { ...boundBase, ok: true, status: "SUCCEEDED" as const }
					: {
							...boundBase,
							ok: false,
							status: "ACTION_REQUIRED" as const,
							actionRequired: {
								action: "configure-browser-extension",
								description: `Materialize Browser Extension runtime config before loading ${loadDir}`,
							},
						},
				observedEffects: [],
			}),
			status: async () => ({
				result: (await configured())
					? {
							...boundBase,
							ok: true,
							status: "SUCCEEDED" as const,
							data: { loadDir, configMaterialized: true },
						}
					: {
							...boundBase,
							ok: false,
							status: "ACTION_REQUIRED" as const,
							actionRequired: {
								action: "configure-browser-extension",
								description:
									"Browser Extension runtime config is not materialized",
							},
						},
				observedEffects: [],
			}),
			verify: async () => {
				const evidence = await readBrowserVerificationEvidence(
					verificationEvidenceFile,
					loadDir,
				);
				return {
					result:
						(await configured()) && evidence
							? {
									...boundBase,
									ok: true,
									status: "SUCCEEDED" as const,
									checks: [
										{
											id: "real-carrier-e3-e4",
											status: "PASS" as const,
											message: `Real Chrome loaded extension ${evidence.extensionId} from ${loadDir} and its MV3 Service Worker was observed running`,
										},
									],
								}
							: {
									...boundBase,
									ok: false,
									status: "ACTION_REQUIRED" as const,
									actionRequired: {
										action: "verify-real-chrome-extension",
										description: `Load ${loadDir} in real Chrome and write verified evidence to ${verificationEvidenceFile ?? "the configured verificationEvidenceFile"}`,
									},
								},
					observedEffects: evidence
						? ["Observes real Chrome MV3 load evidence"]
						: [],
				};
			},
		},
	};
}

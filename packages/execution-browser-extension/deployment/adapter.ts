import { readFileSync } from "node:fs";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	deterministicLoopbackPort,
	ensureModuleSecretFile,
	type ModuleCommandContext,
	moduleWorkspaceStateDirectory,
	readModuleSharedFacts,
	writeModuleSharedFacts,
} from "@tomflow/proflow-module-contract";
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
			id: "STEP-EXECUTION-BROWSER-EXTENSION-01",
			title: "加载 Chrome 扩展",
			state: "TODO",
			responsible: "USER",
			execution: {
				interactive: "pnpm exec -- proflow-execution-browser-extension setup",
				nonInteractive:
					"pnpm exec -- proflow-execution-browser-extension setup --extension-id <id>",
			},
			requiredInputs: [
				{
					name: "extensionId",
					description: "Chrome Extension ID",
					sensitive: false,
				},
			],
			verify: "pnpm exec -- proflow-execution-browser-extension verify",
			successCondition: "配置状态变为“已就绪”",
		},
	],
} as const;
const blockedSetupPlan = {
	steps: [
		{
			id: "STEP-EXECUTION-BROWSER-EXTENSION-02",
			title: "修复扩展配置",
			state: "BLOCKED",
			responsible: "EXTERNAL",
			execution: {
				interactive: "pnpm exec -- proflow-execution-browser-extension setup",
				nonInteractive:
					"pnpm exec -- proflow-execution-browser-extension setup --extension-id <id>",
			},
			requiredInputs: [],
			verify: "pnpm exec -- proflow-execution-browser-extension verify",
			successCondition: "配置状态变为“已就绪”",
			blockedReason: "Extension ID 或生成配置无效",
		},
	],
} as const;
type BrowserSetupState = { extensionId: string };
type BrowserVerificationEvidence = {
	contract: "proflow.browser-extension-verification.v1";
	moduleVersion: string;
	loadDir: string;
	extensionId: string;
	serviceWorker: "RUNNING";
	observedAt: string;
};
const factString = (
	facts: Record<string, unknown> | undefined,
	name: string,
) => (typeof facts?.[name] === "string" ? String(facts[name]) : undefined);
function packageRoot() {
	const candidate = dirname(dirname(fileURLToPath(import.meta.url)));
	return basename(candidate) === "dist" ? dirname(candidate) : candidate;
}
export function browserExtensionLoadDir(workspaceRoot: string) {
	return join(
		resolve(workspaceRoot),
		".proflow",
		"deployment",
		"browser-extension",
		"execution-browser-extension",
	);
}
const stateDir = (context: ModuleCommandContext) =>
	moduleWorkspaceStateDirectory(context, descriptor.moduleRef);
const setupFile = (context: ModuleCommandContext) =>
	join(stateDir(context), "setup.json");
const verificationFile = (context: ModuleCommandContext) =>
	join(stateDir(context), "verification.json");
const executorConfigFile = (context: ModuleCommandContext) =>
	join(stateDir(context), "browser-executor.json");
async function credential(file: string) {
	const value = (await readFile(file, "utf8")).trim();
	if (value.length < 32) throw new Error(`credential ${file} is invalid`);
	return value;
}
function loopbackEndpoint(value: string, name: string) {
	const url = new URL(value);
	if (
		url.protocol !== "http:" ||
		url.hostname !== "127.0.0.1" ||
		url.pathname !== "/" ||
		url.search ||
		url.hash
	)
		throw new Error(`${name} must be a loopback HTTP origin`);
	return value.replace(/\/$/, "");
}
export async function materializeProductionConfig(input: {
	moduleRef: string;
	config: Record<string, string>;
	workspaceRoot: string;
}): Promise<{ loadDir: string }> {
	const context: ModuleCommandContext = { workspaceRoot: input.workspaceRoot };
	const loadDir = await installPackage(context);
	const required = [
		"bridge.endpoint",
		"bridge.token",
		"taskApplication.endpoint",
		"taskApplication.token",
		"approvalApplication.endpoint",
		"approvalApplication.token",
	] as const;
	for (const name of required)
		if (!input.config[name])
			throw new Error(`missing required browser config ${name}`);
	const runtimeConfig = {
		proflowRuntimeBridge: {
			endpoint: loopbackEndpoint(
				input.config["bridge.endpoint"] ?? "",
				"bridge.endpoint",
			),
			token: await credential(input.config["bridge.token"] ?? ""),
		},
		proflowTaskApplication: {
			endpoint: loopbackEndpoint(
				input.config["taskApplication.endpoint"] ?? "",
				"taskApplication.endpoint",
			),
			token: await credential(input.config["taskApplication.token"] ?? ""),
		},
		proflowApprovalApplication: {
			endpoint: loopbackEndpoint(
				input.config["approvalApplication.endpoint"] ?? "",
				"approvalApplication.endpoint",
			),
			token: await credential(input.config["approvalApplication.token"] ?? ""),
		},
	};
	await writeFile(
		join(loadDir, "runtime-config.json"),
		`${JSON.stringify(runtimeConfig, null, 2)}\n`,
		{ mode: 0o600 },
	);
	return { loadDir };
}

async function installPackage(context: ModuleCommandContext) {
	const sourceRoot = packageRoot();
	const loadDir = browserExtensionLoadDir(context.workspaceRoot);
	await mkdir(join(loadDir, "dist"), { recursive: true });
	await cp(
		join(sourceRoot, "dist", "extension"),
		join(loadDir, "dist", "extension"),
		{ recursive: true, force: true },
	);
	await cp(join(sourceRoot, "extension"), join(loadDir, "extension"), {
		recursive: true,
		force: true,
	});
	await cp(join(sourceRoot, "manifest.json"), join(loadDir, "manifest.json"), {
		force: true,
	});
	return loadDir;
}
async function readSetup(
	context: ModuleCommandContext,
): Promise<BrowserSetupState | undefined> {
	try {
		const raw = JSON.parse(await readFile(setupFile(context), "utf8"));
		return typeof raw.extensionId === "string" &&
			/^[a-z]{32}$/.test(raw.extensionId)
			? raw
			: undefined;
	} catch {
		return undefined;
	}
}
async function readEvidence(
	context: ModuleCommandContext,
	loadDir: string,
): Promise<BrowserVerificationEvidence | undefined> {
	try {
		const raw = JSON.parse(
			await readFile(verificationFile(context), "utf8"),
		) as Partial<BrowserVerificationEvidence>;
		return raw.contract === "proflow.browser-extension-verification.v1" &&
			raw.moduleVersion === descriptor.moduleVersion &&
			raw.loadDir === loadDir &&
			typeof raw.extensionId === "string" &&
			/^[a-z]{32}$/.test(raw.extensionId) &&
			raw.serviceWorker === "RUNNING" &&
			typeof raw.observedAt === "string" &&
			!Number.isNaN(Date.parse(raw.observedAt))
			? (raw as BrowserVerificationEvidence)
			: undefined;
	} catch {
		return undefined;
	}
}
function input(context: ModuleCommandContext) {
	const value = context.input;
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return {};
	const extensionId = Reflect.get(value, "extensionId"),
		serviceWorker = Reflect.get(value, "serviceWorker"),
		observedAt = Reflect.get(value, "observedAt");
	return {
		...(typeof extensionId === "string" ? { extensionId } : {}),
		...(serviceWorker === "RUNNING"
			? { serviceWorker: "RUNNING" as const }
			: {}),
		...(typeof observedAt === "string" ? { observedAt } : {}),
	};
}
async function ownFacts(context: ModuleCommandContext) {
	await mkdir(stateDir(context), { recursive: true, mode: 0o700 });
	const loadDir = browserExtensionLoadDir(context.workspaceRoot);
	const bridgeTokenFile = await ensureModuleSecretFile(
		context,
		descriptor.moduleRef,
		"bridge",
	);
	const bridgePort = deterministicLoopbackPort(
		context,
		descriptor.moduleRef,
		"bridge",
	);
	const facts: Record<string, unknown> = {
		loadDir,
		bridgeTokenFile,
		bridgeEndpoint: `http://127.0.0.1:${bridgePort}`,
		verificationEvidenceFile: verificationFile(context),
	};
	const setup = await readSetup(context);
	if (setup) facts.extensionId = setup.extensionId;
	try {
		await readFile(executorConfigFile(context), "utf8");
		facts.browserExecutorConfigPath = executorConfigFile(context);
	} catch {}
	await writeModuleSharedFacts(context, descriptor.moduleRef, facts);
	return facts;
}
async function materialize(
	context: ModuleCommandContext,
	setup: BrowserSetupState,
) {
	const host = await readModuleSharedFacts(context, "platform-host");
	const endpoint = factString(host, "endpoint"),
		taskTokenFile = factString(host, "taskApplicationTokenFile"),
		approvalTokenFile = factString(host, "approvalApplicationTokenFile");
	if (!endpoint || !taskTokenFile || !approvalTokenFile)
		throw new Error("platform-host application shared facts are unavailable");
	const facts = await ownFacts(context);
	const loadDir = String(facts.loadDir);
	const bridgeTokenFile = String(facts.bridgeTokenFile);
	const bridgeEndpoint = String(facts.bridgeEndpoint);
	const runtimeConfig = {
		proflowRuntimeBridge: {
			endpoint: bridgeEndpoint,
			token: await credential(bridgeTokenFile),
		},
		proflowTaskApplication: {
			endpoint,
			token: await credential(taskTokenFile),
		},
		proflowApprovalApplication: {
			endpoint,
			token: await credential(approvalTokenFile),
		},
	};
	await writeFile(
		join(loadDir, "runtime-config.json"),
		`${JSON.stringify(runtimeConfig, null, 2)}\n`,
		{ mode: 0o600 },
	);
	await writeFile(
		executorConfigFile(context),
		`${JSON.stringify({ platformHost: { endpoint, tokenFile: taskTokenFile }, bridge: { extensionId: setup.extensionId, tokenFile: bridgeTokenFile, host: "127.0.0.1", port: Number(new URL(bridgeEndpoint).port) } }, null, 2)}\n`,
		{ mode: 0o600 },
	);
	await writeModuleSharedFacts(context, descriptor.moduleRef, {
		...facts,
		extensionId: setup.extensionId,
		browserExecutorConfigPath: executorConfigFile(context),
	});
}
const failed = (
	code: "SETUP_FAILED" | "START_FAILED",
	message: string,
	retryable = true,
) => ({
	...base,
	ok: false as const,
	status: "FAILED" as const,
	error: { code, message, retryable },
});
export const behaviorAdapter = {
	install: async (context: ModuleCommandContext) => {
		const loadDir = await installPackage(context);
		return {
			result: { ...base, data: { ...(await ownFacts(context)), loadDir } },
			observedEffects: ["Materialize the unpacked MV3 extension package"],
		};
	},
	uninstall: async (_context: ModuleCommandContext) => ({
		result: base,
		observedEffects: [],
	}),
	status: async (context: ModuleCommandContext) => {
		const loadDir = browserExtensionLoadDir(context.workspaceRoot);
		const setup = await readSetup(context);
		const evidence = await readEvidence(context, loadDir);
		return {
			result: {
				...base,
				data: {
					setupStatus:
						setup && evidence
							? ("READY" as const)
							: ("ACTION_REQUIRED" as const),
					runtimeStatus: evidence ? ("RUNNING" as const) : ("STOPPED" as const),
				},
			},
			observedEffects: evidence
				? ["Observes real Chrome MV3 load evidence"]
				: [],
		};
	},
	setup: async (context: ModuleCommandContext) => {
		await mkdir(stateDir(context), { recursive: true, mode: 0o700 });
		const supplied = input(context);
		let setup = await readSetup(context);
		if (supplied.extensionId) {
			if (!/^[a-z]{32}$/.test(supplied.extensionId))
				return {
					result: {
						...failed(
							"SETUP_FAILED",
							"extensionId must be a canonical 32-character Chromium extension id",
							false,
						),
						data: blockedSetupPlan,
					},
					observedEffects: [],
				};
			setup = { extensionId: supplied.extensionId };
			await writeFile(
				setupFile(context),
				`${JSON.stringify(setup, null, 2)}\n`,
				{ mode: 0o600 },
			);
		}
		if (!setup)
			return {
				result: {
					...base,
					ok: false as const,
					status: "ACTION_REQUIRED" as const,
					data: setupPlan,
					actionRequired: {
						action: "load-unpacked-extension",
						description: `Load ${browserExtensionLoadDir(context.workspaceRoot)} in Chrome, copy its extensionId, then run proflow-execution-browser-extension setup --extension-id <id>.`,
					},
				},
				observedEffects: [],
			};
		try {
			await materialize(context, setup);
		} catch (error) {
			return {
				result: {
					...failed(
						"SETUP_FAILED",
						error instanceof Error
							? error.message
							: "browser extension config materialization failed",
					),
					data: blockedSetupPlan,
				},
				observedEffects: [],
			};
		}
		if (supplied.serviceWorker === "RUNNING") {
			const evidence: BrowserVerificationEvidence = {
				contract: "proflow.browser-extension-verification.v1",
				moduleVersion: descriptor.moduleVersion,
				loadDir: browserExtensionLoadDir(context.workspaceRoot),
				extensionId: setup.extensionId,
				serviceWorker: "RUNNING",
				observedAt: supplied.observedAt ?? new Date().toISOString(),
			};
			await writeFile(
				verificationFile(context),
				`${JSON.stringify(evidence, null, 2)}\n`,
				{ mode: 0o600 },
			);
			return {
				result: base,
				observedEffects: ["Records real Chrome MV3 load evidence"],
			};
		}
		return {
			result: {
				...base,
				ok: false as const,
				status: "ACTION_REQUIRED" as const,
				data: setupPlan,
				actionRequired: {
					action: "reload-and-verify-extension",
					description:
						"Reload the unpacked extension, confirm its MV3 service worker is RUNNING, then rerun proflow-execution-browser-extension setup --extension-id <id>.",
				},
			},
			observedEffects: [],
		};
	},
	docs: async (_context: ModuleCommandContext) => ({
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
		observedEffects: [],
	}),
	start: async (context: ModuleCommandContext) => {
		const loadDir = browserExtensionLoadDir(context.workspaceRoot);
		return {
			result: (await readEvidence(context, loadDir))
				? base
				: failed("START_FAILED", "browser extension setup is not READY"),
			observedEffects: [],
		};
	},
	stop: async (_context: ModuleCommandContext) => ({
		result: base,
		observedEffects: [],
	}),
} as const;

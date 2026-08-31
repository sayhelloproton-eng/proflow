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
import { probeChromeExtensionState } from "../src/chrome-extension-state.ts";
import type {
	BrowserExtensionDesktop,
	BrowserExtensionPair,
} from "../src/install-workflow.ts";
import {
	openBrowserExtensionManager,
	runInteractiveBrowserExtensionSetup,
} from "../src/install-workflow.ts";
import { createBrowserExtensionPairingServer } from "../src/pairing.ts";
import { descriptor } from "./descriptor.ts";

const base = {
	contract: "deployment.result.v1",
	ok: true,
	status: "SUCCEEDED",
	moduleRef: descriptor.moduleRef,
	moduleVersion: descriptor.moduleVersion,
} as const;
const blockedSetupPlan = {
	steps: [
		{
			id: "STEP-EXECUTION-BROWSER-EXTENSION-RECOVER",
			title: "重新加载并自动配对扩展",
			state: "BLOCKED",
			responsible: "EXTERNAL",
			execution: {
				interactive: "platform setup",
				nonInteractive: "platform setup",
			},
			requiredInputs: [],
			verify: "platform status",
			successCondition: "配置状态变为“已就绪”",
			blockedReason: "真实 Extension heartbeat 未到达或本地 pairing 失败",
		},
	],
} as const;
type BrowserSetupState = { extensionId: string };
type BrowserInstallFlowState = { developerModeConfirmed: true };
type BrowserVerificationEvidence = {
	contract: "proflow.browser-extension-verification.v1";
	moduleVersion: string;
	loadDir: string;
	extensionId: string;
	extensionInstanceId: string;
	serviceWorker: "RUNNING";
	evidenceSource: "PAIRING_HEARTBEAT";
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
const installFlowFile = (context: ModuleCommandContext) =>
	join(stateDir(context), "install-flow.json");
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
async function readInstallFlow(
	context: ModuleCommandContext,
): Promise<BrowserInstallFlowState | undefined> {
	try {
		const raw = JSON.parse(await readFile(installFlowFile(context), "utf8"));
		return raw.developerModeConfirmed === true
			? ({ developerModeConfirmed: true } as const)
			: undefined;
	} catch {
		return undefined;
	}
}
async function persistDeveloperModeConfirmation(context: ModuleCommandContext) {
	await mkdir(stateDir(context), { recursive: true, mode: 0o700 });
	await writeFile(
		installFlowFile(context),
		`${JSON.stringify({ developerModeConfirmed: true } satisfies BrowserInstallFlowState)}\n`,
		{ mode: 0o600 },
	);
}
async function readEvidenceCandidate(
	context: ModuleCommandContext,
	loadDir: string,
): Promise<BrowserVerificationEvidence | undefined> {
	try {
		const raw = JSON.parse(
			await readFile(verificationFile(context), "utf8"),
		) as Partial<BrowserVerificationEvidence>;
		return raw.contract === "proflow.browser-extension-verification.v1" &&
			typeof raw.moduleVersion === "string" &&
			raw.moduleVersion.length > 0 &&
			raw.loadDir === loadDir &&
			typeof raw.extensionId === "string" &&
			/^[a-z]{32}$/.test(raw.extensionId) &&
			typeof raw.extensionInstanceId === "string" &&
			raw.extensionInstanceId.length > 0 &&
			raw.serviceWorker === "RUNNING" &&
			raw.evidenceSource === "PAIRING_HEARTBEAT" &&
			typeof raw.observedAt === "string" &&
			!Number.isNaN(Date.parse(raw.observedAt))
			? (raw as BrowserVerificationEvidence)
			: undefined;
	} catch {
		return undefined;
	}
}
async function readEvidence(
	context: ModuleCommandContext,
	loadDir: string,
): Promise<BrowserVerificationEvidence | undefined> {
	const evidence = await readEvidenceCandidate(context, loadDir);
	return evidence?.moduleVersion === descriptor.moduleVersion
		? evidence
		: undefined;
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
	const provisioningBridgeTokenFile = await ensureModuleSecretFile(
		context,
		descriptor.moduleRef,
		"provisioning",
	);
	const provisioningBridgePort = deterministicLoopbackPort(
		context,
		descriptor.moduleRef,
		"provisioning",
	);
	const facts: Record<string, unknown> = {
		loadDir,
		bridgeTokenFile,
		bridgeEndpoint: `http://127.0.0.1:${bridgePort}`,
		provisioningBridgeTokenFile,
		provisioningBridgeEndpoint: `http://127.0.0.1:${provisioningBridgePort}`,
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
async function materializeRuntimeConfig(context: ModuleCommandContext) {
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
	const provisioningBridgeTokenFile = String(facts.provisioningBridgeTokenFile);
	const provisioningBridgeEndpoint = String(facts.provisioningBridgeEndpoint);
	await writeFile(
		join(loadDir, "runtime-config.json"),
		`${JSON.stringify(
			{
				proflowRuntimeBridge: {
					endpoint: bridgeEndpoint,
					token: await credential(bridgeTokenFile),
				},
				proflowProvisioningBridge: {
					endpoint: provisioningBridgeEndpoint,
					token: await credential(provisioningBridgeTokenFile),
				},
				proflowTaskApplication: {
					endpoint,
					token: await credential(taskTokenFile),
				},
				proflowApprovalApplication: {
					endpoint,
					token: await credential(approvalTokenFile),
				},
			},
			null,
			2,
		)}\n`,
		{ mode: 0o600 },
	);
	return {
		facts,
		loadDir,
		bridgeTokenFile,
		bridgeEndpoint,
		provisioningBridgeTokenFile,
		provisioningBridgeEndpoint,
		endpoint,
		taskTokenFile,
	};
}

async function materializeExecutorConfig(
	context: ModuleCommandContext,
	setup: BrowserSetupState,
	prepared?: Awaited<ReturnType<typeof materializeRuntimeConfig>>,
) {
	const resolved = prepared ?? (await materializeRuntimeConfig(context));
	await writeFile(
		executorConfigFile(context),
		`${JSON.stringify({ platformHost: { endpoint: resolved.endpoint, tokenFile: resolved.taskTokenFile }, bridge: { extensionId: setup.extensionId, tokenFile: resolved.bridgeTokenFile, host: "127.0.0.1", port: Number(new URL(resolved.bridgeEndpoint).port) } }, null, 2)}\n`,
		{ mode: 0o600 },
	);
	await writeModuleSharedFacts(context, descriptor.moduleRef, {
		...resolved.facts,
		extensionId: setup.extensionId,
		browserExecutorConfigPath: executorConfigFile(context),
	});
}

async function persistPairedBrowserExtension(
	context: ModuleCommandContext,
	prepared: Awaited<ReturnType<typeof materializeRuntimeConfig>>,
	identity: { extensionId: string; extensionInstanceId: string },
) {
	const setup: BrowserSetupState = { extensionId: identity.extensionId };
	await writeFile(setupFile(context), `${JSON.stringify(setup, null, 2)}\n`, {
		mode: 0o600,
	});
	await materializeExecutorConfig(context, setup, prepared);
	const evidence: BrowserVerificationEvidence = {
		contract: "proflow.browser-extension-verification.v1",
		moduleVersion: descriptor.moduleVersion,
		loadDir: prepared.loadDir,
		extensionId: identity.extensionId,
		extensionInstanceId: identity.extensionInstanceId,
		serviceWorker: "RUNNING",
		evidenceSource: "PAIRING_HEARTBEAT",
		observedAt: new Date().toISOString(),
	};
	await writeFile(
		verificationFile(context),
		`${JSON.stringify(evidence, null, 2)}\n`,
		{ mode: 0o600 },
	);
	return identity;
}

type RunningBridgeProbe =
	| { kind: "ABSENT" }
	| {
			kind: "PRESENT";
			identity?: { extensionId: string; extensionInstanceId: string };
	  };
function connectionRefused(error: unknown) {
	if (!(error instanceof TypeError)) return false;
	const cause = Reflect.get(error, "cause");
	return (
		typeof cause === "object" &&
		cause !== null &&
		Reflect.get(cause, "code") === "ECONNREFUSED"
	);
}
async function probeRunningBridgeSession(
	prepared: Awaited<ReturnType<typeof materializeRuntimeConfig>>,
	extensionId: string,
	timeoutMs: number,
): Promise<RunningBridgeProbe> {
	try {
		const response = await fetch(
			`${prepared.bridgeEndpoint}/v1/session/status`,
			{
				headers: {
					authorization: `Bearer ${await credential(prepared.bridgeTokenFile)}`,
					origin: `chrome-extension://${extensionId}`,
				},
				signal: AbortSignal.timeout(Math.max(25, Math.min(500, timeoutMs))),
			},
		);
		if (!response.ok)
			throw new Error(`RUNNING_BRIDGE_STATUS_${response.status}`);
		const body = (await response.json()) as unknown;
		if (typeof body !== "object" || body === null || Array.isArray(body))
			throw new Error("RUNNING_BRIDGE_STATUS_INVALID");
		if (Reflect.get(body, "online") !== true) return { kind: "PRESENT" };
		const extensionInstanceId = Reflect.get(body, "extensionInstanceId");
		if (
			typeof extensionInstanceId !== "string" ||
			extensionInstanceId.length === 0
		)
			throw new Error("RUNNING_BRIDGE_STATUS_INVALID");
		return {
			kind: "PRESENT",
			identity: { extensionId, extensionInstanceId },
		};
	} catch (error) {
		if (connectionRefused(error)) return { kind: "ABSENT" };
		throw error;
	}
}
async function revalidateRunningBridge(
	prepared: Awaited<ReturnType<typeof materializeRuntimeConfig>>,
	extensionId: string,
	timeoutMs: number,
	onWaiting?: (input: {
		loadDir: string;
		endpoint: string;
	}) => void | Promise<void>,
) {
	const startedAt = Date.now();
	const graceMs = Math.min(2_000, Math.max(25, Math.floor(timeoutMs / 4)));
	let waitingShown = false;
	while (true) {
		const remainingMs = Math.max(1, timeoutMs - (Date.now() - startedAt));
		const probe = await probeRunningBridgeSession(
			prepared,
			extensionId,
			remainingMs,
		);
		if (probe.kind === "ABSENT") return undefined;
		if (probe.identity) return probe.identity;
		const elapsedMs = Date.now() - startedAt;
		if (!waitingShown && elapsedMs >= graceMs) {
			waitingShown = true;
			await onWaiting?.({
				loadDir: prepared.loadDir,
				endpoint: prepared.bridgeEndpoint,
			});
		}
		if (elapsedMs >= timeoutMs) throw new Error("PAIRING_TIMEOUT");
		await new Promise((resolve) =>
			setTimeout(resolve, Math.min(100, Math.max(10, timeoutMs - elapsedMs))),
		);
	}
}

export async function pairBrowserExtensionSetup(
	context: ModuleCommandContext,
	options: {
		timeoutMs?: number;
		onWaiting?: (input: {
			loadDir: string;
			endpoint: string;
		}) => void | Promise<void>;
	} = {},
): Promise<{ extensionId: string; extensionInstanceId: string }> {
	await mkdir(stateDir(context), { recursive: true, mode: 0o700 });
	await installPackage(context);
	const existingSetup = await readSetup(context);
	const existingEvidence = await readEvidenceCandidate(
		context,
		browserExtensionLoadDir(context.workspaceRoot),
	);
	const canRevalidateExisting = Boolean(
		existingSetup &&
			existingEvidence &&
			existingSetup.extensionId === existingEvidence.extensionId,
	);

	const prepared = await materializeRuntimeConfig(context);
	if (canRevalidateExisting && existingSetup) {
		const runningIdentity = await revalidateRunningBridge(
			prepared,
			existingSetup.extensionId,
			options.timeoutMs ?? 120_000,
			options.onWaiting,
		);
		if (runningIdentity)
			return persistPairedBrowserExtension(context, prepared, runningIdentity);
	}
	const pairing = await createBrowserExtensionPairingServer({
		token: await credential(prepared.bridgeTokenFile),
		host: "127.0.0.1",
		port: Number(new URL(prepared.bridgeEndpoint).port),
		pairingTimeoutMs: options.timeoutMs ?? 120_000,
	});
	try {
		const pairingPromise = pairing.waitForPairing();
		if (canRevalidateExisting) {
			const timeoutMs = options.timeoutMs ?? 120_000;
			const revalidationGraceMs = Math.min(
				2_000,
				Math.max(25, Math.floor(timeoutMs / 4)),
			);
			const revalidated = await Promise.race([
				pairingPromise.then((identity) => ({
					kind: "PAIRED" as const,
					identity,
				})),
				new Promise<{ kind: "WAITING" }>((resolve) =>
					setTimeout(() => resolve({ kind: "WAITING" }), revalidationGraceMs),
				),
			]);
			if (revalidated.kind === "PAIRED") {
				return persistPairedBrowserExtension(
					context,
					prepared,
					revalidated.identity,
				);
			}
		}

		await options.onWaiting?.({
			loadDir: prepared.loadDir,
			endpoint: pairing.endpoint,
		});
		return persistPairedBrowserExtension(
			context,
			prepared,
			await pairingPromise,
		);
	} finally {
		await pairing.close();
	}
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
		const chromeState =
			setup && evidence && setup.extensionId === evidence.extensionId
				? await probeChromeExtensionState({
						extensionId: evidence.extensionId,
						loadDir,
					})
				: "MISSING";
		const setupReady = Boolean(
			setup &&
				evidence &&
				setup.extensionId === evidence.extensionId &&
				chromeState === "ENABLED",
		);
		return {
			result: {
				...base,
				data: {
					setupStatus: setupReady
						? ("READY" as const)
						: ("ACTION_REQUIRED" as const),
					runtimeStatus: "NOT_APPLICABLE" as const,
					...(setupReady
						? {}
						: {
								issues: [
									{
										scope: "SETUP" as const,
										code: "EXTENSION_LOAD_REQUIRED",
										message: "Chrome 扩展尚未加载或缺少可验证的运行证据",
										relatedModuleRefs: ["chrome-runtime"],
										nextCommand: "platform setup",
									},
								],
							}),
				},
			},
			observedEffects: [],
		};
	},
	setup: async (context: ModuleCommandContext) => {
		try {
			const input =
				typeof context.input === "object" && context.input !== null
					? (context.input as {
							timeoutMs?: number;
							desktop?: BrowserExtensionDesktop;
							pair?: BrowserExtensionPair;
							developerModeConfirmed?: boolean;
						})
					: undefined;
			const installFlow = await readInstallFlow(context);
			const developerModeConfirmed =
				input?.developerModeConfirmed === true ||
				installFlow?.developerModeConfirmed === true;
			if (!developerModeConfirmed) {
				await openBrowserExtensionManager(input?.desktop);
				return {
					result: {
						...base,
						ok: false as const,
						status: "ACTION_REQUIRED" as const,
						data: {
							steps: [
								{
									id: "STEP-EXECUTION-BROWSER-EXTENSION-01",
									title: "开启 Chrome 开发者模式",
									description: "请在刚打开的扩展管理页开启右上角“开发者模式”。",
									state: "TODO" as const,
									responsible: "USER" as const,
									execution: {
										interactive: "platform setup",
										nonInteractive: "platform setup",
									},
									requiredInputs: [],
									verify: "platform status",
									successCondition: "用户确认开发者模式已开启",
									humanAction: "开启开发者模式后返回终端确认",
								},
							],
						},
						actionRequired: {
							action: "confirm-browser-developer-mode",
							description: "请开启 Chrome 开发者模式后确认。",
						},
					},
					observedEffects: [],
				};
			}
			if (
				input?.developerModeConfirmed === true &&
				installFlow?.developerModeConfirmed !== true
			) {
				await persistDeveloperModeConfirmation(context);
			}
			await runInteractiveBrowserExtensionSetup({
				workspaceRoot: context.workspaceRoot,
				...(input?.timeoutMs === undefined
					? {}
					: { timeoutMs: input.timeoutMs }),
				...(input?.desktop === undefined ? {} : { desktop: input.desktop }),
				...(input?.pair === undefined ? {} : { pair: input.pair }),
			});
			return {
				result: base,
				observedEffects: ["Materialize the unpacked MV3 extension package"],
			};
		} catch (error) {
			return {
				result: {
					...failed(
						"SETUP_FAILED",
						error instanceof Error
							? error.message
							: "browser extension setup failed",
					),
					data: blockedSetupPlan,
				},
				observedEffects: [],
			};
		}
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

export type BridgeConfig = { endpoint: string; token: string };

export type BrowserStructuredLogEntry = {
	level: "DEBUG" | "INFO" | "WARN" | "ERROR";
	component: string;
	capability?: string;
	operation?: string;
	status?: string;
	errorCode?: string;
	correlationId?: string;
	taskId?: string;
	nodeId?: string;
	runNo?: number;
	agentPackageRef?: string;
	roleRef?: string;
	workerRef?: string;
	executionRef?: string;
	messageRef?: string;
	artifactRef?: string;
	evidenceRef?: string;
	conversationLocator?: string;
	operationRef?: string;
	attemptNo?: number;
	tabId?: number;
};

type StorageLocalPort = {
	get(key: string): Promise<Record<string, unknown>>;
	set(value: Record<string, unknown>): Promise<void>;
};

type ManagedRuntimeConfig = {
	proflowRuntimeBridge?: unknown;
	proflowLocalToolBridge?: unknown;
	proflowProvisioningBridge?: unknown;
	proflowTaskApplication?: unknown;
	proflowApprovalApplication?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeLogErrorCode(error: unknown, fallback: string): string {
	const value = error instanceof Error ? error.message : error;
	return typeof value === "string" && /^[A-Z][A-Z0-9_.:-]{0,159}$/.test(value)
		? value
		: fallback;
}

function parseConfig(value: unknown): BridgeConfig | null {
	if (!isRecord(value)) return null;
	const endpoint = value.endpoint;
	const token = value.token;
	if (typeof endpoint !== "string" || typeof token !== "string") return null;
	let url: URL;
	try {
		url = new URL(endpoint);
	} catch {
		return null;
	}
	if (
		url.protocol !== "http:" ||
		url.hostname !== "127.0.0.1" ||
		url.pathname !== "/" ||
		url.search !== "" ||
		url.hash !== "" ||
		token.length < 32
	)
		return null;
	return { endpoint: endpoint.replace(/\/$/, ""), token };
}

export function createApplicationClient(options: {
	storageLocal: StorageLocalPort;
	runtimeConfigUrl: string;
	fetchImpl?: typeof fetch;
	bridgeTimeoutMs?: number;
}) {
	const fetchImpl = options.fetchImpl ?? fetch;
	const bridgeTimeoutMs = options.bridgeTimeoutMs ?? 5_000;

	const fetchBridge = async (
		config: BridgeConfig,
		path: string,
		init: RequestInit = {},
	): Promise<Response> =>
		fetchImpl(`${config.endpoint}${path}`, {
			...init,
			signal: init.signal ?? AbortSignal.timeout(bridgeTimeoutMs),
			headers: {
				authorization: `Bearer ${config.token}`,
				"content-type": "application/json",
				...(init.headers ?? {}),
			},
		});

	const configFromStorage = async (key: string): Promise<BridgeConfig | null> => {
		const stored = await options.storageLocal.get(key);
		return parseConfig(stored[key]);
	};

	const bridgeConfig = () => configFromStorage("proflowRuntimeBridge");
	const localToolBridgeConfig = () => configFromStorage("proflowLocalToolBridge");
	const provisioningBridgeConfig = () =>
		configFromStorage("proflowProvisioningBridge");

	const resolveOwnerApplication = async (
		surface: "task" | "approval",
	): Promise<BridgeConfig | null> => {
		const config = await bridgeConfig();
		if (!config) return null;
		try {
			const response = await fetchBridge(config, "/v1/applications/config", {
				signal: AbortSignal.timeout(2_000),
			});
			if (!response.ok) return null;
			const body: unknown = await response.json();
			return isRecord(body) ? parseConfig(body[surface]) : null;
		} catch {
			return null;
		}
	};

	const taskApplicationConfig = async (): Promise<BridgeConfig | null> =>
		(await configFromStorage("proflowTaskApplication")) ??
		(await resolveOwnerApplication("task"));

	const approvalApplicationConfig = async (): Promise<BridgeConfig | null> =>
		(await configFromStorage("proflowApprovalApplication")) ??
		(await resolveOwnerApplication("approval"));

	const invokeSurface = async (
		surface: "task" | "approval" | "observer",
		operation: string,
		input: Record<string, unknown>,
	): Promise<unknown> => {
		const config =
			surface === "approval"
				? await approvalApplicationConfig()
				: await taskApplicationConfig();
		if (!config)
			throw new Error(
				surface === "approval"
					? "APPROVAL_APPLICATION_NOT_CONFIGURED"
					: surface === "task"
						? "TASK_APPLICATION_NOT_CONFIGURED"
						: "OBSERVER_APPLICATION_NOT_CONFIGURED",
			);
		const response = await fetchImpl(`${config.endpoint}/application/${surface}`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${config.token}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ operation, input }),
		});
		const body = (await response.json()) as unknown;
		if (!response.ok) {
			const fallback =
				surface === "approval"
					? "APPROVAL_APPLICATION_REQUEST_FAILED"
					: surface === "task"
						? "TASK_APPLICATION_REQUEST_FAILED"
						: "OBSERVER_APPLICATION_REQUEST_FAILED";
			const detail =
				isRecord(body) && typeof body.error === "string" ? body.error : fallback;
			throw new Error(detail);
		}
		return body;
	};

	const emitLog = async (entry: BrowserStructuredLogEntry): Promise<void> => {
		const config = await taskApplicationConfig();
		if (!config) throw new Error("LOG_SINK_NOT_CONFIGURED");
		const response = await fetchImpl(`${config.endpoint}/application/log`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${config.token}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ timestamp: new Date().toISOString(), ...entry }),
			signal: AbortSignal.timeout(bridgeTimeoutMs),
		});
		if (!response.ok) throw new Error("LOG_SINK_REJECTED");
	};

	return Object.freeze({
		async bootstrap(): Promise<void> {
			let response: Response;
			try {
				response = await fetchImpl(options.runtimeConfigUrl, {
					cache: "no-store",
					signal: AbortSignal.timeout(bridgeTimeoutMs),
				});
			} catch {
				return;
			}
			if (!response.ok) return;
			const raw = (await response.json()) as unknown;
			if (!isRecord(raw)) return;
			const managed = raw as ManagedRuntimeConfig;
			const bridge = parseConfig(managed.proflowRuntimeBridge);
			const localTools = parseConfig(managed.proflowLocalToolBridge);
			const provisioning = parseConfig(managed.proflowProvisioningBridge);
			const task = parseConfig(managed.proflowTaskApplication);
			const approval = parseConfig(managed.proflowApprovalApplication);
			if (!bridge) throw new Error("MANAGED_RUNTIME_CONFIG_INVALID");
			await options.storageLocal.set({
				proflowRuntimeBridge: bridge,
				...(localTools ? { proflowLocalToolBridge: localTools } : {}),
				...(provisioning ? { proflowProvisioningBridge: provisioning } : {}),
				...(task ? { proflowTaskApplication: task } : {}),
				...(approval ? { proflowApprovalApplication: approval } : {}),
			});
		},
		bridgeConfig,
		localToolBridgeConfig,
		provisioningBridgeConfig,
		taskApplicationConfig,
		approvalApplicationConfig,
		fetchBridge,
		async publishCarrierAttentions(
			extensionInstanceId: string,
			carrierAttentions: readonly unknown[],
		): Promise<void> {
			const config = await bridgeConfig().catch(() => null);
			if (!config) return;
			const query = `?extensionInstanceId=${encodeURIComponent(extensionInstanceId)}`;
			const response = await fetchBridge(config, `/v1/carrier/attentions${query}`, {
				method: "POST",
				body: JSON.stringify({ carrierAttentions }),
			});
			if (!response.ok) throw new Error("CARRIER_ATTENTION_PUBLISH_REJECTED");
		},
		invokeTask: (operation: string, input: Record<string, unknown>) =>
			invokeSurface("task", operation, input),
		invokeApproval: (operation: string, input: Record<string, unknown>) =>
			invokeSurface("approval", operation, input),
		invokeObserver: (operation: string, input: Record<string, unknown>) =>
			invokeSurface("observer", operation, input),
		emitLog,
	});
}

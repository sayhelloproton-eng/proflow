export interface ProviderProbeConfig {
	baseUrl: string;
	credential?: string;
	timeoutMs?: number;
	fetch?: typeof fetch;
}

export type ProviderModel = {
	id: string;
	object?: string;
	created?: number;
	ownedBy?: string;
};

export type ProviderProbeResult =
	| {
			status: "READY";
			baseUrl: string;
			models: readonly ProviderModel[];
			reachable: true;
			authenticated: true;
			message: string;
	  }
	| {
			status: "AUTH_REQUIRED" | "AUTH_FAILED" | "PROTOCOL_INVALID";
			reachable: true;
			authenticated: false;
			message: string;
	  }
	| {
			status: "UNREACHABLE";
			reachable: false;
			authenticated: false;
			message: string;
	  };

const DEFAULT_TIMEOUT_MS = 10_000;

function apiBaseUrl(baseUrl: string): string {
	const url = new URL(baseUrl);
	const pathname = url.pathname.replace(/\/+$/, "");
	url.pathname = pathname.endsWith("/v1") ? pathname : `${pathname}/v1`;
	return url.toString().replace(/\/$/, "");
}

function inventoryEndpoints(baseUrl: string): readonly {
	url: string;
	apiBaseUrl: string;
}[] {
	const original = new URL(baseUrl);
	const pathname = original.pathname.replace(/\/+$/, "");
	const rootPath = pathname.endsWith("/v1") ? pathname.slice(0, -3) : pathname;
	const versionedBase = new URL(original);
	versionedBase.pathname = `${rootPath}/v1`;
	const rootBase = new URL(original);
	rootBase.pathname = rootPath || "/";
	return [
		{
			url: `${versionedBase.toString().replace(/\/$/, "")}/models`,
			apiBaseUrl: versionedBase.toString().replace(/\/$/, ""),
		},
		{
			url: `${rootBase.toString().replace(/\/$/, "")}/models`,
			apiBaseUrl: rootBase.toString().replace(/\/$/, ""),
		},
	];
}

function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === "AbortError";
}

function describeError(error: unknown, timeoutMs: number): string {
	if (isAbortError(error)) {
		return `provider API probe timed out after ${timeoutMs}ms`;
	}
	return "provider API request failed";
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseInventory(value: unknown): readonly ProviderModel[] | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return undefined;
	const data = Reflect.get(value, "data");
	if (!Array.isArray(data)) return undefined;
	const models: ProviderModel[] = [];
	for (const item of data) {
		if (typeof item !== "object" || item === null || Array.isArray(item))
			return undefined;
		const id = optionalString(Reflect.get(item, "id"));
		const created = Reflect.get(item, "created");
		if (!id || (created !== undefined && !Number.isSafeInteger(created)))
			return undefined;
		const object = optionalString(Reflect.get(item, "object"));
		const ownedBy = optionalString(Reflect.get(item, "owned_by"));
		models.push({
			id,
			...(object ? { object } : {}),
			...(typeof created === "number" ? { created } : {}),
			...(ownedBy ? { ownedBy } : {}),
		});
	}
	return models;
}

export async function probeProvider(
	config: ProviderProbeConfig,
): Promise<ProviderProbeResult> {
	const {
		baseUrl,
		credential,
		timeoutMs = DEFAULT_TIMEOUT_MS,
		fetch: fetchImplementation = globalThis.fetch,
	} = config;
	const normalizedBaseUrl = apiBaseUrl(baseUrl);
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const headers = new Headers();
		if (credential) headers.set("authorization", `Bearer ${credential}`);
		let selectedBaseUrl = normalizedBaseUrl;
		let response: Response | undefined;
		for (const endpoint of inventoryEndpoints(baseUrl)) {
			response = await fetchImplementation(endpoint.url, {
				headers,
				signal: controller.signal,
			});
			selectedBaseUrl = endpoint.apiBaseUrl;
			if (response.status !== 404) break;
		}
		if (!response)
			throw new TypeError("provider inventory endpoint was not attempted");
		if (response.status === 401 || response.status === 403)
			return {
				status: credential ? "AUTH_FAILED" : "AUTH_REQUIRED",
				reachable: true,
				authenticated: false,
				message: credential
					? "provider API rejected the configured credential"
					: "provider API requires authentication",
			};
		if (!response.ok)
			return {
				status: "PROTOCOL_INVALID",
				reachable: true,
				authenticated: false,
				message: `provider models endpoint returned HTTP ${response.status}`,
			};
		let payload: unknown;
		try {
			payload = await response.json();
		} catch {
			return {
				status: "PROTOCOL_INVALID",
				reachable: true,
				authenticated: false,
				message: "provider models endpoint did not return JSON",
			};
		}
		const models = parseInventory(payload);
		if (!models)
			return {
				status: "PROTOCOL_INVALID",
				reachable: true,
				authenticated: false,
				message:
					"provider models endpoint did not match the OpenAI-compatible inventory contract",
			};
		return {
			status: "READY",
			baseUrl: selectedBaseUrl,
			models,
			reachable: true,
			authenticated: true,
			message: "provider OpenAI-compatible inventory verified",
		};
	} catch (error) {
		return {
			status: "UNREACHABLE",
			reachable: false,
			authenticated: false,
			message: describeError(error, timeoutMs),
		};
	} finally {
		clearTimeout(timer);
	}
}

export function createProviderProbe(
	config: ProviderProbeConfig,
): () => Promise<ProviderProbeResult> {
	return () => probeProvider(config);
}

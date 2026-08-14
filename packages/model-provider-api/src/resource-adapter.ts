export interface ProviderProbeConfig {
	baseUrl: string;
	credential?: string;
	timeoutMs?: number;
}

export interface ProviderProbeResult {
	reachable: boolean;
	authenticated: boolean;
	message: string;
}

const DEFAULT_TIMEOUT_MS = 10_000;

function modelsEndpoint(baseUrl: string): string {
	const trimmed = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
	return `${trimmed}/models`;
}

function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === "AbortError";
}

function describeError(error: unknown, timeoutMs: number): string {
	if (isAbortError(error)) {
		return `provider API probe timed out after ${timeoutMs}ms`;
	}
	return error instanceof Error ? error.message : "provider API request failed";
}

export function createProviderProbe(
	config: ProviderProbeConfig,
): () => Promise<ProviderProbeResult> {
	const { baseUrl, credential, timeoutMs = DEFAULT_TIMEOUT_MS } = config;
	return async () => {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		let response: Response;
		try {
			response =
				credential === undefined
					? await fetch(modelsEndpoint(baseUrl), { signal: controller.signal })
					: await fetch(modelsEndpoint(baseUrl), {
							headers: { authorization: `Bearer ${credential}` },
							signal: controller.signal,
						});
		} catch (error) {
			clearTimeout(timer);
			return {
				reachable: false,
				authenticated: false,
				message: describeError(error, timeoutMs),
			};
		}
		clearTimeout(timer);
		const authenticated = response.status >= 200 && response.status < 300;
		const rejected = response.status === 401 || response.status === 403;
		return {
			reachable: true,
			authenticated,
			message: authenticated
				? "provider API reachable and credential accepted"
				: rejected
					? "provider API reachable but credential rejected"
					: `provider API reachable but returned HTTP ${response.status}`,
		};
	};
}

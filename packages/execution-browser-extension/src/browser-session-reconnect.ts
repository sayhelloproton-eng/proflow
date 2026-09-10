type ReconnectState = "DISCONNECTED" | "RECONNECTING" | "ONLINE";

/** One in-flight session, five consecutive failures per burst, then alarm retry. */
export function createBrowserReconnectOwner(options: {
	runSession(online: () => void): Promise<void>;
	sleep(ms: number): Promise<void>;
	now(): number;
}) {
	let flight: Promise<void> | null = null;
	let retryAfter = 0;
	let state: ReconnectState = "DISCONNECTED";
	async function run() {
		let failures = 0;
		while (failures < 5) {
			state = "RECONNECTING";
			try {
				await options.runSession(() => {
					state = "ONLINE";
					failures = 0;
				});
				state = "DISCONNECTED";
				return;
			} catch {
				state = "DISCONNECTED";
				failures++;
				if (failures < 5) await options.sleep(1000 * 2 ** (failures - 1));
			}
		}
		retryAfter = options.now() + 60_000;
	}
	return {
		state: () => state,
		start(): Promise<void> {
			if (flight) return flight;
			if (options.now() < retryAfter) return Promise.resolve();
			flight = run().finally(() => {
				flight = null;
			});
			return flight;
		},
	};
}

/** Browser-session scoped, never a durable Worker identity or proof of online. */
export async function restoreBrowserSessionIdentity(
	storage: {
		get(key: string): Promise<Record<string, unknown>>;
		set(value: Record<string, unknown>): Promise<void>;
	},
	extensionId: string,
	moduleVersion: string,
	createId: () => string,
): Promise<string> {
	const key = "proflowBridgeSessionIdentity";
	const raw = (await storage.get(key))[key];
	if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
		const value = raw as Record<string, unknown>;
		if (
			value.extensionId === extensionId &&
			value.moduleVersion === moduleVersion &&
			typeof value.extensionInstanceId === "string" &&
			/^extension:[A-Za-z0-9-]+$/.test(value.extensionInstanceId)
		)
			return value.extensionInstanceId;
	}
	const extensionInstanceId = createId();
	await storage.set({
		[key]: { extensionId, moduleVersion, extensionInstanceId },
	});
	return extensionInstanceId;
}

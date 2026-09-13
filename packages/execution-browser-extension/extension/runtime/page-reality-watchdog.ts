export function createPageRealityRecoveryLoop(options: {
	intervalMs: number;
	recover(): Promise<void>;
	schedule(callback: () => void, intervalMs: number): unknown;
}) {
	let inFlight: Promise<void> | null = null;
	let started = false;

	const run = (): Promise<void> => {
		if (inFlight) return inFlight;
		const recovery = Promise.resolve().then(() => options.recover());
		inFlight = recovery.finally(() => {
			inFlight = null;
		});
		return inFlight;
	};

	return Object.freeze({
		run,
		start(): boolean {
			if (started) return false;
			started = true;
			try {
				options.schedule(() => {
					void run().catch(() => undefined);
				}, options.intervalMs);
				return true;
			} catch (error) {
				started = false;
				throw error;
			}
		},
	});
}

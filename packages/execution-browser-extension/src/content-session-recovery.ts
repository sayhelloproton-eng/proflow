export async function recoverMissingContentReceiver<Value>(options: {
	observe(): Promise<Value | null>;
	inject(): Promise<void>;
}): Promise<Value | null> {
	const initial = await options.observe();
	if (initial !== null) return initial;
	try {
		await options.inject();
	} catch {
		return null;
	}
	return options.observe();
}

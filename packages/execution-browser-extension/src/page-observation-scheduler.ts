export const pageObservationMutationOptions = Object.freeze({
	subtree: true,
	childList: true,
	attributes: true,
	characterData: true,
}) satisfies MutationObserverInit;

type PageObservationSchedulerInput = {
	publish(): unknown;
	schedule(callback: () => void, delayMs: number): unknown;
	delayMs?: number;
};

export function createBoundedPageObservationScheduler(
	input: PageObservationSchedulerInput,
) {
	const delayMs = input.delayMs ?? 100;
	if (!Number.isInteger(delayMs) || delayMs < 0)
		throw new TypeError("PAGE_OBSERVATION_DELAY_INVALID");
	let pending = false;
	return Object.freeze({
		request(): boolean {
			if (pending) return false;
			pending = true;
			input.schedule(() => {
				pending = false;
				void input.publish();
			}, delayMs);
			return true;
		},
		pending(): boolean {
			return pending;
		},
	});
}

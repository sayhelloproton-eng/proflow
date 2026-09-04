export type ChatGptCarrierIdentity = {
	roleRef: string;
	workerRef: string | null;
};

function canonicalRoleRef(segment: string): string | null {
	if (!/^g-[A-Za-z0-9_-]+$/.test(segment)) return null;
	// ChatGPT may decorate a real 32-character GPT id with a readable slug.
	// Preserve short synthetic refs used by tests while normalizing real URLs.
	return /^(g-[A-Za-z0-9_-]{32})(?:-.+)?$/.exec(segment)?.[1] ?? segment;
}

export function parseChatGptCarrierIdentity(
	raw: string,
): ChatGptCarrierIdentity | null {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return null;
	}
	if (url.protocol !== "https:" || url.hostname !== "chatgpt.com") return null;
	const segments = url.pathname.split("/").filter(Boolean);
	if (segments[0] !== "g" || !segments[1]) return null;
	const roleRef = canonicalRoleRef(segments[1]);
	if (!roleRef) return null;
	if (segments.length === 2) return { roleRef, workerRef: null };
	if (
		segments.length !== 4 ||
		segments[2] !== "c" ||
		!segments[3] ||
		segments[3].length > 512 ||
		!/^[A-Za-z0-9_-]+$/.test(segments[3])
	)
		return null;
	return { roleRef, workerRef: segments[3] };
}

export function sameChatGptCarrierTarget(left: string, right: string): boolean {
	const leftIdentity = parseChatGptCarrierIdentity(left);
	const rightIdentity = parseChatGptCarrierIdentity(right);
	if (leftIdentity && rightIdentity)
		return (
			leftIdentity.roleRef === rightIdentity.roleRef &&
			leftIdentity.workerRef === rightIdentity.workerRef
		);
	try {
		return new URL(left).href === new URL(right).href;
	} catch {
		return false;
	}
}

type BrowserOpenBoundary = Readonly<{
	requestedUrl: string;
	receiptGeneration: number;
}>;

type BrowserObservationReceipt = Readonly<{
	tabId: number;
	url: string;
	observedAt: string;
}>;

export function createBrowserOpenObservationGate() {
	let receiptGeneration = 0;
	const receipts = new Map<
		number,
		Readonly<{ url: string; receiptGeneration: number }>
	>();
	return Object.freeze({
		beginOpen(requestedUrl: string): BrowserOpenBoundary {
			return Object.freeze({ requestedUrl, receiptGeneration });
		},
		recordReceipt(observation: BrowserObservationReceipt): void {
			receiptGeneration += 1;
			receipts.set(
				observation.tabId,
				Object.freeze({
					url: observation.url,
					receiptGeneration,
				}),
			);
		},
		accepts(tabId: number, boundary: BrowserOpenBoundary): boolean {
			const receipt = receipts.get(tabId);
			return (
				receipt !== undefined &&
				receipt.receiptGeneration > boundary.receiptGeneration &&
				sameChatGptCarrierTarget(boundary.requestedUrl, receipt.url)
			);
		},
	});
}

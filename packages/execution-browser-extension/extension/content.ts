export {};

type PageState = "IDLE" | "BUSY" | "BLOCKED" | "UNKNOWN";
type ContentCommand = {
	type: "PROFLOW_PAGE_COMMAND";
	contentInstanceId: string;
	expectedUrl: string;
	operation: "observe" | "input" | "click" | "submit" | "verify";
	selector?: string;
	value?: string;
	fingerprint?: string;
};
type ChromeContent = {
	runtime: {
		sendMessage(message: unknown): Promise<unknown>;
		onMessage: {
			addListener(
				listener: (
					message: ContentCommand,
					sender: unknown,
					sendResponse: (value: unknown) => void,
				) => boolean | undefined,
			): void;
		};
	};
};
declare const chrome: ChromeContent;

const contentInstanceId = `content:${crypto.randomUUID()}`;

function pageState(): { pageState: PageState; activityKind: string | null } {
	if (document.querySelector('[role="dialog"]'))
		return { pageState: "BLOCKED", activityKind: "ACTION_PERMISSION" };
	if (
		document.querySelector(
			'[data-testid="stop-button"], button[aria-label*="Stop"]',
		)
	)
		return { pageState: "BUSY", activityKind: "GENERATING" };
	if (
		document.querySelector(
			'#prompt-textarea, textarea, [contenteditable="true"]',
		)
	)
		return { pageState: "IDLE", activityKind: null };
	return { pageState: "UNKNOWN", activityKind: null };
}

function observation() {
	return {
		url: location.href,
		contentInstanceId,
		...pageState(),
		observedAt: new Date().toISOString(),
	};
}

function safeElement(selector: string | undefined): HTMLElement {
	if (!selector || selector.length > 512) throw new Error("SELECTOR_INVALID");
	const element = document.querySelector(selector);
	if (!(element instanceof HTMLElement)) throw new Error("ELEMENT_NOT_FOUND");
	return element;
}

function hasFingerprint(fingerprint: string | undefined): boolean {
	return Boolean(fingerprint && document.body.innerText.includes(fingerprint));
}

chrome.runtime.onMessage.addListener((command, _sender, sendResponse) => {
	void (async () => {
		if (
			command.type !== "PROFLOW_PAGE_COMMAND" ||
			command.contentInstanceId !== contentInstanceId ||
			command.expectedUrl !== location.href
		)
			throw new Error("STALE_CONTENT_SESSION");
		if (command.operation === "observe") return observation();
		if (command.operation === "verify")
			return {
				...observation(),
				verified: hasFingerprint(command.fingerprint),
			};
		if (pageState().pageState === "BLOCKED")
			throw new Error("PAGE_PERMISSION_REQUIRES_HUMAN");
		if (command.operation === "click") {
			safeElement(command.selector).click();
			return observation();
		}
		const input = safeElement(command.selector ?? "#prompt-textarea");
		if (command.value === undefined || command.value.length > 4_096)
			throw new Error("INPUT_BUDGET_EXCEEDED");
		input.focus();
		if (
			input instanceof HTMLTextAreaElement ||
			input instanceof HTMLInputElement
		)
			input.value = command.value;
		else input.textContent = command.value;
		input.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				inputType: "insertText",
				data: command.value,
			}),
		);
		if (command.operation === "submit")
			safeElement(
				'button[data-testid="send-button"], button[aria-label*="Send"]',
			).click();
		return observation();
	})().then(
		(value) => sendResponse({ ok: true, value }),
		(error: unknown) =>
			sendResponse({
				ok: false,
				error: error instanceof Error ? error.message : "PAGE_COMMAND_FAILED",
			}),
	);
	return true;
});

const publish = () =>
	chrome.runtime.sendMessage({
		type: "PROFLOW_CONTENT_OBSERVATION",
		observation: observation(),
	});
void publish();
const observer = new MutationObserver(() => {
	void publish();
});
observer.observe(document.documentElement, {
	subtree: true,
	childList: true,
	attributes: true,
});

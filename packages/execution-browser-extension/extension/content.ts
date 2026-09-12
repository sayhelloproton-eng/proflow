import type { PermissionSemanticAction } from "../src/carrier-permission.js";
import {
	observeChatGptPage,
	performChatGptPermissionAction,
	submitChatGptComposer,
	writeChatGptInput,
} from "../src/chatgpt-runtime-adapter.js";
import {
	createBoundedPageObservationScheduler,
	pageObservationMutationOptions,
} from "../src/page-observation-scheduler.js";
import { containsSubmittedFingerprint } from "../src/submitted-message.js";

type ContentCommand = {
	type: "PROFLOW_PAGE_COMMAND";
	contentInstanceId: string;
	expectedUrl: string;
	operation:
		| "observe"
		| "input"
		| "click"
		| "submit"
		| "verify"
		| "permissionAction";
	selector?: string;
	value?: string;
	fingerprint?: string;
	permissionFingerprint?: string;
	permissionAction?: PermissionSemanticAction;
};
type ContentSnapshotRequest = { type: "PROFLOW_PAGE_SNAPSHOT_REQUEST" };
type ChromeContent = {
	runtime: {
		sendMessage(message: unknown): Promise<unknown>;
		onMessage: {
			addListener(
				listener: (
					message: ContentCommand | ContentSnapshotRequest,
					sender: unknown,
					sendResponse: (value: unknown) => void,
				) => boolean | undefined,
			): void;
		};
	};
};
declare const chrome: ChromeContent;

const contentInstanceId = `content:${crypto.randomUUID()}`;

function pageState(): ReturnType<typeof observeChatGptPage> {
	return observeChatGptPage(document);
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
	return containsSubmittedFingerprint(
		[...document.querySelectorAll('[data-message-author-role="user"]')].map(
			(element) => ({
				authorRole: element.getAttribute("data-message-author-role"),
				textContent: element.textContent,
			}),
		),
		fingerprint,
	);
}

chrome.runtime.onMessage.addListener((command, _sender, sendResponse) => {
	void (async () => {
		if (command.type === "PROFLOW_PAGE_SNAPSHOT_REQUEST") return observation();
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
		if (command.operation === "permissionAction") {
			if (!command.permissionFingerprint || !command.permissionAction)
				throw new Error("PERMISSION_ACTION_INVALID");
			performChatGptPermissionAction(
				document,
				command.permissionFingerprint,
				command.permissionAction,
			);
			return observation();
		}
		if (pageState().pageState === "BLOCKED") throw new Error("PAGE_BLOCKED");
		if (command.operation === "click") {
			safeElement(command.selector).click();
			return observation();
		}
		if (command.value === undefined || command.value.length > 4_096)
			throw new Error("INPUT_BUDGET_EXCEEDED");
		if (command.operation === "submit") {
			await submitChatGptComposer(document, command.value);
			return observation();
		}
		writeChatGptInput(
			document,
			command.selector ?? "#prompt-textarea",
			command.value,
		);
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
const schedulePublish = createBoundedPageObservationScheduler({
	publish,
	schedule: (callback, delayMs) => setTimeout(callback, delayMs),
});
const observer = new MutationObserver(() => {
	schedulePublish.request();
});
observer.observe(document.documentElement, pageObservationMutationOptions);

import {
	type ActionPermissionFacts,
	detectActionPermission,
	type PermissionSemanticAction,
	permissionActionAllowed,
	permissionSemanticAction,
} from "./carrier-permission.ts";
import { submitControlledComposer } from "./composer-submit.ts";

export type ChatGptPageReality = {
	pageState: "IDLE" | "BUSY" | "BLOCKED" | "UNKNOWN";
	activityKind:
		| "GENERATING"
		| "ACTION_PERMISSION"
		| "ACTION_RUNNING"
		| "WAITING_HUMAN"
		| null;
	blockerFacts?: ActionPermissionFacts;
};

export function classifyChatGptPageSignals(input: {
	permission: ActionPermissionFacts | null;
	hasDialog: boolean;
	isGenerating: boolean;
	hasComposer: boolean;
}): ChatGptPageReality {
	if (input.permission)
		return {
			pageState: "BLOCKED",
			activityKind: "ACTION_PERMISSION",
			blockerFacts: input.permission,
		};
	if (input.hasDialog)
		return { pageState: "BLOCKED", activityKind: "WAITING_HUMAN" };
	if (input.isGenerating)
		return { pageState: "BUSY", activityKind: "GENERATING" };
	if (input.hasComposer) return { pageState: "IDLE", activityKind: null };
	return { pageState: "UNKNOWN", activityKind: null };
}

type PermissionDomMatch = {
	facts: ActionPermissionFacts;
	buttons: Map<PermissionSemanticAction, HTMLButtonElement>;
};

const composerSelector = '#prompt-textarea, textarea, [contenteditable="true"]';
const sendSelector =
	'button[data-testid="send-button"], button[aria-label*="Send"], button[aria-label*="发送"]';

function buttonLabel(button: HTMLButtonElement): string {
	return (button.textContent ?? "").replace(/\s+/g, " ").trim();
}

function actionPermissionDom(document: Document): PermissionDomMatch | null {
	const view = document.defaultView;
	if (!view) return null;
	const semanticButtons = [...document.querySelectorAll("button")].filter(
		(button): button is HTMLButtonElement =>
			button instanceof view.HTMLButtonElement &&
			permissionSemanticAction(buttonLabel(button)) !== null,
	);
	for (const seed of semanticButtons) {
		let root: HTMLElement | null = seed.parentElement;
		for (
			let depth = 0;
			root && depth < 8;
			depth += 1, root = root.parentElement
		) {
			const buttons = [...root.querySelectorAll("button")].filter(
				(button): button is HTMLButtonElement =>
					button instanceof view.HTMLButtonElement,
			);
			const facts = detectActionPermission([
				{
					text: root.textContent ?? "",
					buttonLabels: buttons.map(buttonLabel),
				},
			]);
			if (!facts) continue;
			const mapped = new Map<PermissionSemanticAction, HTMLButtonElement>();
			for (const button of buttons) {
				const action = permissionSemanticAction(buttonLabel(button));
				if (action && !mapped.has(action)) mapped.set(action, button);
			}
			return { facts, buttons: mapped };
		}
	}
	return null;
}

export function observeChatGptPage(document: Document): ChatGptPageReality {
	const permission = actionPermissionDom(document);
	return classifyChatGptPageSignals({
		permission: permission?.facts ?? null,
		hasDialog: document.querySelector('[role="dialog"]') !== null,
		isGenerating:
			document.querySelector(
				'[data-testid="stop-button"], button[aria-label*="Stop"], button[aria-label*="停止"]',
			) !== null,
		hasComposer: document.querySelector(composerSelector) !== null,
	});
}

export function performChatGptPermissionAction(
	document: Document,
	expectedFingerprint: string,
	action: PermissionSemanticAction,
): ActionPermissionFacts {
	const permission = actionPermissionDom(document);
	if (!permission) throw new Error("ACTION_PERMISSION_NOT_FOUND");
	if (!permissionActionAllowed(permission.facts, expectedFingerprint, action))
		throw new Error("STALE_PERMISSION");
	const button = permission.buttons.get(action);
	if (
		!button ||
		button.disabled ||
		button.getAttribute("aria-disabled") === "true"
	)
		throw new Error("PERMISSION_ACTION_NOT_READY");
	button.click();
	return permission.facts;
}

function composerElement(document: Document): HTMLElement {
	const view = document.defaultView;
	const element = document.querySelector(composerSelector);
	if (!view || !(element instanceof view.HTMLElement))
		throw new Error("COMPOSER_NOT_FOUND");
	return element;
}

function readElementValue(element: HTMLElement): string {
	const view = element.ownerDocument.defaultView;
	if (!view) return "";
	if (
		element instanceof view.HTMLTextAreaElement ||
		element instanceof view.HTMLInputElement
	)
		return element.value;
	return element.textContent ?? "";
}

function nativeWrite(element: HTMLElement, value: string): void {
	const view = element.ownerDocument.defaultView;
	if (!view) throw new Error("DOM_WINDOW_NOT_READY");
	if (
		element instanceof view.HTMLTextAreaElement ||
		element instanceof view.HTMLInputElement
	) {
		const prototype =
			element instanceof view.HTMLTextAreaElement
				? view.HTMLTextAreaElement.prototype
				: view.HTMLInputElement.prototype;
		const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
		if (!setter) throw new Error("COMPOSER_NATIVE_SETTER_MISSING");
		setter.call(element, value);
		return;
	}
	element.textContent = value;
}

function dispatchComposerInput(element: HTMLElement, value: string): void {
	const view = element.ownerDocument.defaultView;
	if (!view) throw new Error("DOM_WINDOW_NOT_READY");
	element.dispatchEvent(
		new view.InputEvent("input", {
			bubbles: true,
			inputType: "insertText",
			data: value,
		}),
	);
}

function nextComposerFrame(document: Document): Promise<void> {
	const view = document.defaultView;
	if (!view) return Promise.reject(new Error("DOM_WINDOW_NOT_READY"));
	return new Promise((resolve) => {
		let settled = false;
		const finish = () => {
			if (settled) return;
			settled = true;
			resolve();
		};
		view.requestAnimationFrame(finish);
		view.setTimeout(finish, 50);
	});
}

function sendButton(document: Document): HTMLButtonElement | null {
	const view = document.defaultView;
	const element = document.querySelector(sendSelector);
	return view && element instanceof view.HTMLButtonElement ? element : null;
}

export async function submitChatGptComposer(
	document: Document,
	value: string,
): Promise<void> {
	const composer = composerElement(document);
	composer.focus();
	await submitControlledComposer(
		{
			write: (next) => nativeWrite(composer, next),
			dispatchInput: (next) => dispatchComposerInput(composer, next),
			readValue: () => readElementValue(composer),
			submitReady: () => {
				const button = sendButton(document);
				return Boolean(
					button &&
						!button.disabled &&
						button.getAttribute("aria-disabled") !== "true",
				);
			},
			nextFrame: () => nextComposerFrame(document),
			clickSubmit: () => {
				const button = sendButton(document);
				if (
					!button ||
					button.disabled ||
					button.getAttribute("aria-disabled") === "true"
				)
					throw new Error("COMPOSER_SUBMIT_NOT_READY");
				button.click();
			},
		},
		value,
	);
}

export function writeChatGptInput(
	document: Document,
	selector: string,
	value: string,
): void {
	if (!selector || selector.length > 512) throw new Error("SELECTOR_INVALID");
	const view = document.defaultView;
	const element = document.querySelector(selector);
	if (!view || !(element instanceof view.HTMLElement))
		throw new Error("ELEMENT_NOT_FOUND");
	element.focus();
	nativeWrite(element, value);
	dispatchComposerInput(element, value);
}

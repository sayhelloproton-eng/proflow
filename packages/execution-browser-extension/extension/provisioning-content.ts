import {
	type CustomGptCapability,
	type CustomGptEditorPort,
	type CustomGptKnowledgeFile,
	type CustomGptProvisioningRequest,
	createCustomGptEditorDriver,
	parseCustomGptProvisioningRequest,
} from "../src/custom-gpt-editor-driver.js";

type ProvisioningSurface = {
	kind: "CUSTOM_GPT_DEPLOYMENT_PROVISIONING";
	instanceId: string;
	url: string;
};

type ProvisioningCommand = {
	type: "PROFLOW_PROVISIONING_COMMAND";
	operation: "PROVISION_CUSTOM_GPT" | "FINALIZE_CUSTOM_GPT_AUTH";
	request: Record<string, unknown>;
};

type ChromeRuntime = {
	runtime: {
		sendMessage(message: unknown): Promise<unknown>;
		onMessage: {
			addListener(
				listener: (
					message: ProvisioningCommand,
					sender: unknown,
					sendResponse: (value: unknown) => void,
				) => boolean | undefined,
			): void;
		};
	};
};
declare const chrome: ChromeRuntime;

const provisioningSurface: ProvisioningSurface = Object.freeze({
	kind: "CUSTOM_GPT_DEPLOYMENT_PROVISIONING",
	instanceId: `provisioning:${crypto.randomUUID()}`,
	url: location.href,
});

const sleep = (milliseconds: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function normalize(value: string | null | undefined): string {
	return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function editorSurfaceReady(): boolean {
	return (
		location.protocol === "https:" &&
		location.hostname === "chatgpt.com" &&
		location.pathname.startsWith("/gpts/editor")
	);
}

function elementSemanticText(element: Element): string {
	return normalize(
		[
			element.getAttribute("aria-label"),
			element.getAttribute("placeholder"),
			element.getAttribute("name"),
			element.textContent,
		]
			.filter(Boolean)
			.join(" "),
	);
}

function matchesAny(element: Element, candidates: readonly string[]): boolean {
	const semantic = elementSemanticText(element);
	return candidates.some((candidate) =>
		semantic.includes(normalize(candidate)),
	);
}

function controlFromLabel(label: HTMLLabelElement): HTMLElement | null {
	if (label.htmlFor) {
		const linked = document.getElementById(label.htmlFor);
		if (linked instanceof HTMLElement) return linked;
	}
	const selector =
		'input:not([type="file"]), textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"]';
	const nested = label.querySelector<HTMLElement>(selector);
	if (nested) return nested;
	let scope: HTMLElement | null = label.parentElement;
	for (let depth = 0; depth < 4 && scope; depth += 1) {
		const controls = [...scope.querySelectorAll<HTMLElement>(selector)];
		if (controls.length === 1) return controls[0] ?? null;
		scope = scope.parentElement;
	}
	return null;
}

function findControl(candidates: readonly string[]): HTMLElement {
	for (const label of document.querySelectorAll("label"))
		if (matchesAny(label, candidates)) {
			const control = controlFromLabel(label);
			if (control) return control;
		}
	for (const element of document.querySelectorAll<HTMLElement>(
		'input, textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"]',
	))
		if (matchesAny(element, candidates)) return element;
	throw new Error(`GPT_EDITOR_CONTROL_NOT_FOUND:${candidates[0] ?? "unknown"}`);
}

function setControlValue(element: HTMLElement, value: string): void {
	if (
		element instanceof HTMLInputElement ||
		element instanceof HTMLTextAreaElement ||
		element instanceof HTMLSelectElement
	) {
		const prototype =
			element instanceof HTMLInputElement
				? HTMLInputElement.prototype
				: element instanceof HTMLTextAreaElement
					? HTMLTextAreaElement.prototype
					: HTMLSelectElement.prototype;
		const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
		if (setter) setter.call(element, value);
		else element.value = value;
	} else {
		element.textContent = value;
	}
	element.dispatchEvent(
		new InputEvent("input", { bubbles: true, data: value }),
	);
	element.dispatchEvent(new Event("change", { bubbles: true }));
}

function controlValue(element: HTMLElement): string {
	if (
		element instanceof HTMLInputElement ||
		element instanceof HTMLTextAreaElement ||
		element instanceof HTMLSelectElement
	)
		return element.value.replaceAll("\r\n", "\n");
	return (element.textContent ?? "").replaceAll("\r\n", "\n");
}

async function waitForReadback(
	code: string,
	predicate: () => boolean,
): Promise<void> {
	for (let attempt = 0; attempt < 600; attempt += 1) {
		if (predicate()) return;
		await sleep(100);
	}
	throw new Error(code);
}

function clickable(candidates: readonly string[]): HTMLElement | null {
	for (const element of document.querySelectorAll<HTMLElement>(
		'button, [role="button"], [role="option"], [role="menuitem"], [role="radio"]',
	))
		if (matchesAny(element, candidates)) return element;
	return null;
}

async function waitForClickable(
	candidates: readonly string[],
	attempts = 30,
): Promise<HTMLElement> {
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		const element = clickable(candidates);
		if (element) return element;
		await sleep(100);
	}
	throw new Error(`GPT_EDITOR_ACTION_NOT_FOUND:${candidates[0] ?? "unknown"}`);
}

const fieldLabels = {
	displayName: ["Name", "名称", "Name your GPT", "为你的 GPT 命名"],
	description: [
		"Description",
		"描述",
		"Add a short description about what this GPT does",
		"添加有关此 GPT 的功能的简短描述",
	],
	instructions: ["Instructions", "指令"],
} as const;

async function ensureConfigureMode(): Promise<void> {
	try {
		findControl(fieldLabels.displayName);
		return;
	} catch {}
	const configure = await waitForClickable(["Configure", "配置"], 60);
	configure.click();
	for (let attempt = 0; attempt < 80; attempt += 1) {
		try {
			findControl(fieldLabels.displayName);
			return;
		} catch {
			await sleep(100);
		}
	}
	throw new Error("GPT_EDITOR_CONFIGURE_SURFACE_NOT_READY");
}

const capabilityLabels: Record<CustomGptCapability, readonly string[]> = {
	webSearch: ["Web search", "网页搜索", "网络搜索", "浏览网页"],
	imageGeneration: ["Image generation", "图像生成", "图片生成"],
	codeInterpreter: [
		"Code Interpreter & Data Analysis",
		"Code Interpreter",
		"Data Analysis",
		"代码解释器",
		"代码解译器",
	],
};

function conversationStarterControls(minimum: number): HTMLElement[] {
	const label = [...document.querySelectorAll<HTMLLabelElement>("label")].find(
		(element) => matchesAny(element, ["Conversation starter", "对话开场白"]),
	);
	if (!label) return [];
	let scope: HTMLElement | null = label.parentElement;
	for (let depth = 0; depth < 4 && scope; depth += 1) {
		const controls = [
			...scope.querySelectorAll<HTMLElement>(
				'input[type="text"], textarea:not([data-testid="gizmo-instructions-input"])',
			),
		];
		if (controls.length >= minimum) return controls;
		scope = scope.parentElement;
	}
	return [];
}

async function replaceConversationStarters(values: readonly string[]) {
	const controls = conversationStarterControls(values.length);
	if (controls.length < values.length)
		throw new Error("GPT_EDITOR_STARTER_CONTROL_NOT_FOUND");
	for (let index = 0; index < values.length; index += 1)
		setControlValue(controls[index] as HTMLElement, values[index] ?? "");
}

function currentGptId(): string | null {
	const match = /\/(g-[a-zA-Z0-9_-]+)(?:\/|$)/.exec(location.pathname);
	return match?.[1] ?? null;
}

async function knowledgeFileInput(): Promise<HTMLInputElement> {
	const label = [...document.querySelectorAll<HTMLLabelElement>("label")].find(
		(element) => matchesAny(element, ["Knowledge", "知识"]),
	);
	if (label) {
		let scope: HTMLElement | null = label.parentElement;
		for (let depth = 0; depth < 4 && scope; depth += 1) {
			const inputs = [
				...scope.querySelectorAll<HTMLInputElement>('input[type="file"]'),
			];
			if (inputs.length === 1) return inputs[0] as HTMLInputElement;
			scope = scope.parentElement;
		}
	}
	const upload = clickable([
		"Upload files",
		"Upload file",
		"Add files",
		"上传文件",
		"添加文件",
	]);
	if (upload) upload.click();
	for (let attempt = 0; attempt < 40; attempt += 1) {
		const candidates = [
			...document.querySelectorAll<HTMLInputElement>('input[type="file"]'),
		];
		if (candidates.length === 1) return candidates[0] as HTMLInputElement;
		await sleep(100);
	}
	throw new Error("GPT_EDITOR_KNOWLEDGE_INPUT_NOT_FOUND");
}

async function fetchKnowledgeRelay(url: string): Promise<ArrayBuffer> {
	const result = await chrome.runtime.sendMessage({
		type: "PROFLOW_PROVISIONING_RELAY_FETCH",
		url,
	});
	if (typeof result !== "object" || result === null)
		throw new Error("KNOWLEDGE_RELAY_BACKGROUND_INVALID");
	const record = result as Record<string, unknown>;
	if (record.ok !== true || typeof record.base64 !== "string")
		throw new Error(
			typeof record.error === "string"
				? record.error
				: "KNOWLEDGE_RELAY_BACKGROUND_FAILED",
		);
	const binary = atob(record.base64);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1)
		bytes[index] = binary.charCodeAt(index);
	return bytes.buffer;
}

async function sha256Bytes(bytes: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return `sha256:${[...new Uint8Array(digest)]
		.map((value) => value.toString(16).padStart(2, "0"))
		.join("")}`;
}

async function waitForKnowledgeName(name: string): Promise<void> {
	await waitForReadback(`GPT_EDITOR_KNOWLEDGE_UPLOAD_TIMEOUT:${name}`, () =>
		knowledgeReadbackMatches(name),
	);
}

async function uploadKnowledge(files: readonly CustomGptKnowledgeFile[]) {
	for (const descriptor of files) {
		if (knowledgeReadbackMatches(descriptor.name))
			throw new Error(`GPT_EDITOR_KNOWLEDGE_CONTENT_UNVERIFIED:${descriptor.name}`);
		const input = await knowledgeFileInput();
		const bytes = await fetchKnowledgeRelay(descriptor.url);
		if (bytes.byteLength !== descriptor.sizeBytes)
			throw new Error("KNOWLEDGE_RELAY_SIZE_MISMATCH");
		if ((await sha256Bytes(bytes)) !== descriptor.sha256)
			throw new Error("KNOWLEDGE_RELAY_HASH_MISMATCH");
		const transfer = new DataTransfer();
		transfer.items.add(
			new File([bytes], descriptor.name, { type: descriptor.mime }),
		);
		input.files = transfer.files;
		input.dispatchEvent(new Event("change", { bubbles: true }));
		await waitForKnowledgeName(descriptor.name);
	}
}

const privateVisibilityLabels = [
	"Only me",
	"Private",
	"只有我",
	"私有",
	"仅自己",
] as const;

const nonPrivateVisibilityLabels = [
	"Anyone",
	"Public",
	"Link",
	"GPT Store",
	"Workspace",
	"所有人",
	"公开",
	"链接",
	"工作区",
] as const;

function semanticValues(element: Element): string[] {
	const referencedText = (attribute: "aria-labelledby" | "aria-describedby") =>
		(element.getAttribute(attribute) ?? "")
			.split(/\s+/)
			.filter(Boolean)
			.map((id) => document.getElementById(id)?.textContent ?? "")
			.join(" ");
	return [
		element.getAttribute("aria-label"),
		referencedText("aria-labelledby"),
		referencedText("aria-describedby"),
		element.getAttribute("data-value"),
		element.getAttribute("value"),
		element.textContent,
	]
		.filter((value): value is string => Boolean(value))
		.map(normalize);
}

function matchesExactSemantic(
	element: Element,
	candidates: readonly string[],
): boolean {
	const expected = new Set(candidates.map(normalize));
	return semanticValues(element).some((value) => expected.has(value));
}

function matchesBoundedSemantic(
	element: Element,
	candidates: readonly string[],
): boolean {
	const values = semanticValues(element);
	return candidates.some((candidate) => {
		const expected = normalize(candidate);
		return values.some(
			(value) =>
				value === expected ||
				value.startsWith(`${expected} `) ||
				value.endsWith(` ${expected}`),
		);
	});
}

function available(element: HTMLElement): boolean {
	const style = getComputedStyle(element);
	return (
		element.getClientRects().length > 0 &&
		style.display !== "none" &&
		style.visibility !== "hidden" &&
		element.getAttribute("aria-hidden") !== "true" &&
		!element.hasAttribute("disabled") &&
		element.getAttribute("aria-disabled") !== "true"
	);
}

function configureSurfaceReady(): boolean {
	const knowledgeVisible = [...document.querySelectorAll<HTMLElement>("label")].some(
		(label) =>
			available(label) && matchesExactSemantic(label, ["Knowledge", "知识"]),
	);
	if (!knowledgeVisible) return false;
	try {
		const name = findControl(fieldLabels.displayName);
		return available(name);
	} catch {
		return false;
	}
}

function actionSchemaControl(): HTMLElement | null {
	for (const label of document.querySelectorAll<HTMLLabelElement>("label")) {
		if (!available(label)) continue;
		if (
			!matchesBoundedSemantic(label, [
				"OpenAPI schema",
				"OpenAPI Schema",
				"OpenAPI 架构",
			])
		)
			continue;
		const control = controlFromLabel(label);
		if (control && available(control)) return control;
	}
	for (const control of document.querySelectorAll<HTMLElement>(
		'textarea[placeholder*="OpenAPI" i], textarea[aria-label*="OpenAPI" i], [role="textbox"][aria-label*="OpenAPI" i]',
	))
		if (available(control)) return control;
	return null;
}

function visibleEditorFailure(): string | null {
	const text = normalize(document.body.innerText);
	for (const marker of [
		"保存草稿时出错",
		"error saving draft",
		"gpt 说明不得超过 8000 个字符",
		"gpt instructions cannot exceed 8000 characters",
		"gpt description cannot exceed 8000 characters",
	])
		if (text.includes(normalize(marker))) return marker;
	return null;
}

function assertNoVisibleEditorFailure(): void {
	const failure = visibleEditorFailure();
	if (failure) throw new Error(`GPT_EDITOR_VISIBLE_ERROR:${failure}`);
}

function privateVisibilityControl(): HTMLElement | null {
	const selector =
		'input[type="radio"], label, button, [role="button"], [role="radio"], [role="option"], [role="menuitem"], [role="menuitemradio"]';
	for (const element of document.querySelectorAll<HTMLElement>(selector)) {
		if (
			available(element) &&
			matchesBoundedSemantic(element, privateVisibilityLabels) &&
			!matchesBoundedSemantic(element, nonPrivateVisibilityLabels)
		)
			return element;
	}
	return null;
}

function selected(element: HTMLElement): boolean {
	if (element instanceof HTMLInputElement && element.type === "radio")
		return element.checked;
	if (element instanceof HTMLLabelElement && element.htmlFor) {
		const control = document.getElementById(element.htmlFor);
		if (control instanceof HTMLInputElement && control.type === "radio")
			return control.checked;
	}
	return (
		element.getAttribute("aria-checked") === "true" ||
		element.getAttribute("aria-selected") === "true" ||
		element.getAttribute("aria-pressed") === "true" ||
		element.getAttribute("data-state") === "checked"
	);
}

function carrierGptId(value: unknown): string {
	if (typeof value !== "string") throw new Error("ROLE_CARRIER_URL_INVALID");
	const url = new URL(value);
	const match = /^\/g\/(g-[A-Za-z0-9_-]+)$/.exec(url.pathname);
	if (
		url.origin !== "https://chatgpt.com" ||
		url.username !== "" ||
		url.password !== "" ||
		url.search !== "" ||
		url.hash !== "" ||
		!match?.[1]
	)
		throw new Error("ROLE_CARRIER_URL_INVALID");
	return match[1];
}

async function waitForAuthSemantic(
	root: ParentNode,
	candidates: readonly string[],
	selector = 'button, [role="button"], [role="radio"], [role="option"], label',
): Promise<HTMLElement> {
	for (let attempt = 0; attempt < 120; attempt += 1) {
		for (const element of root.querySelectorAll<HTMLElement>(selector))
			if (available(element) && matchesBoundedSemantic(element, candidates))
				return element;
		await sleep(100);
	}
	throw new Error(
		`GPT_EDITOR_AUTH_CONTROL_NOT_FOUND:${candidates[0] ?? "unknown"}`,
	);
}

function existingActionEditButton(): HTMLElement | null {
	const actionLabel = [...document.querySelectorAll<HTMLElement>("label")].find(
		(element) => matchesExactSemantic(element, ["Actions", "操作"]),
	);
	let scope: HTMLElement | null = actionLabel?.parentElement ?? null;
	for (let depth = 0; depth < 5 && scope; depth += 1) {
		const buttons = [
			...scope.querySelectorAll<HTMLElement>('button, [role="button"]'),
		].filter(available);
		const create = buttons.find((element) =>
			matchesBoundedSemantic(element, [
				"Create new action",
				"New action",
				"创建新操作",
			]),
		);
		if (create) {
			return (
				buttons.find(
					(element) =>
						element !== create &&
						elementSemanticText(element) === "" &&
						normalize(element.parentElement?.parentElement?.textContent)
							.length > 0,
				) ?? null
			);
		}
		scope = scope.parentElement;
	}
	return null;
}

async function openExistingActionEditor(): Promise<void> {
	const authLabels = ["Authentication", "身份验证", "认证"] as const;
	if (clickable(authLabels) || actionSchemaControl()) return;
	const edit = existingActionEditButton();
	if (!edit) throw new Error("GPT_EDITOR_ACTION_EDIT_NOT_FOUND");
	edit.click();
	for (let attempt = 0; attempt < 120; attempt += 1) {
		if (clickable(authLabels) || actionSchemaControl()) return;
		await sleep(100);
	}
	throw new Error("GPT_EDITOR_ACTION_EDITOR_NOT_READY");
}

async function waitForAuthSettingsButton(): Promise<HTMLElement> {
	const labels = ["Authentication", "身份验证", "认证"] as const;
	for (let attempt = 0; attempt < 120; attempt += 1) {
		for (const label of document.querySelectorAll<HTMLElement>("label")) {
			if (!available(label) || !matchesExactSemantic(label, labels)) continue;
			let container: HTMLElement | null = label.parentElement;
			for (let depth = 0; depth < 4 && container; depth += 1) {
				const buttons = [
					...container.querySelectorAll<HTMLElement>("button"),
				].filter(available);
				const [button] = buttons;
				if (buttons.length === 1 && button) return button;
				container = container.parentElement;
			}
		}
		await sleep(100);
	}
	throw new Error("GPT_EDITOR_AUTH_SETTINGS_BUTTON_NOT_FOUND");
}

async function returnFromActionEditor(): Promise<void> {
	if (configureSurfaceReady()) {
		assertNoVisibleEditorFailure();
		return;
	}
	let back: HTMLButtonElement | undefined;
	for (let attempt = 0; attempt < 80; attempt += 1) {
		if (configureSurfaceReady()) {
			assertNoVisibleEditorFailure();
			return;
		}
		back = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
			(button) => {
				if (!available(button)) return false;
				if (matchesBoundedSemantic(button, ["Back", "返回"])) return true;
				if ((button.textContent ?? "").trim().length > 0) return false;
				const context = normalize(
					button.parentElement?.parentElement?.textContent ?? "",
				);
				return (
					context.includes("add action") ||
					context.includes("添加操作") ||
					context.includes("edit action") ||
					context.includes("编辑操作")
				);
			},
		);
		if (back) break;
		await sleep(100);
	}
	if (!back) throw new Error("GPT_EDITOR_ACTION_BACK_NOT_FOUND");
	back.click();
	await waitForReadback("GPT_EDITOR_CONFIGURE_RETURN_TIMEOUT", configureSurfaceReady);
	assertNoVisibleEditorFailure();
}

async function configureBearerAuthDraft(credential: string) {
	if (credential.length < 32) throw new Error("ROLE_CREDENTIAL_INVALID");
	await openExistingActionEditor();
	(await waitForAuthSettingsButton()).click();
	let dialog: HTMLElement | null = null;
	for (let attempt = 0; attempt < 600; attempt += 1) {
		dialog =
			[...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find(
				(candidate) => available(candidate),
			) ?? null;
		if (dialog) break;
		await sleep(100);
	}
	if (!dialog) throw new Error("GPT_EDITOR_AUTH_DIALOG_NOT_FOUND");
	const authRadio = async (labels: readonly string[]) => {
		for (let attempt = 0; attempt < 120; attempt += 1) {
			for (const radio of dialog.querySelectorAll<HTMLElement>(
				'input[type="radio"], [role="radio"]',
			)) {
				let container: HTMLElement | null = radio.parentElement;
				for (let depth = 0; depth < 3 && container; depth += 1) {
					if (matchesBoundedSemantic(container, labels)) return radio;
					container = container.parentElement;
				}
			}
			await sleep(100);
		}
		throw new Error(
			`GPT_EDITOR_AUTH_RADIO_NOT_FOUND:${labels[0] ?? "unknown"}`,
		);
	};
	const apiKey = await authRadio(["API Key", "API 密钥"]);
	if (!selected(apiKey)) apiKey.click();
	const bearer = await authRadio(["Bearer"]);
	if (!selected(bearer)) bearer.click();
	let keyInput: HTMLInputElement | null = null;
	for (let attempt = 0; attempt < 120; attempt += 1) {
		const candidate = dialog.querySelector<HTMLInputElement>(
			'input[type="password"]',
		);
		if (candidate && available(candidate)) {
			keyInput = candidate;
			break;
		}
		await sleep(100);
	}
	if (!keyInput) throw new Error("GPT_EDITOR_AUTH_KEY_INPUT_NOT_FOUND");
	setControlValue(keyInput, credential);
	if (controlValue(keyInput) !== credential)
		throw new Error("GPT_EDITOR_AUTH_KEY_READBACK_MISMATCH");
	(await waitForAuthSemantic(dialog, ["Save", "保存"])).click();
	await waitForReadback(
		"GPT_EDITOR_AUTH_SAVE_TIMEOUT",
		() => !available(dialog),
	);
	await returnFromActionEditor();
}

function savedConfirmationVisible(): boolean {
	const labels = [
		"Settings saved",
		"设置已保存",
		"GPT updated",
		"GPT 已更新",
	] as const;
	return [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].some(
		(dialog) =>
			available(dialog) &&
			labels.some((label) =>
				normalize(dialog.textContent).includes(normalize(label)),
			),
	);
}

async function finalizeBearerAuth(credential: string) {
	await configureBearerAuthDraft(credential);
	assertNoVisibleEditorFailure();
	(await waitForAuthSemantic(document, ["Update", "更新"])).click();
	await waitForReadback(
		"GPT_EDITOR_AUTH_UPDATE_TIMEOUT",
		savedConfirmationVisible,
	);
	const gptId = currentGptId();
	if (!gptId) throw new Error("GPT_EDITOR_GPT_ID_MISSING");
	return { status: "AUTH_UPDATED" as const, gptId };
}

async function selectPrivateVisibility(): Promise<void> {
	let control: HTMLElement | null = null;
	for (let attempt = 0; attempt < 80; attempt += 1) {
		control = privateVisibilityControl();
		if (control) break;
		await sleep(100);
	}
	if (!control) throw new Error("GPT_EDITOR_PRIVATE_CONTROL_NOT_FOUND");
	if (!selected(control)) control.click();
	for (let attempt = 0; attempt < 40; attempt += 1) {
		const current = privateVisibilityControl();
		if (current && selected(current)) return;
		await sleep(100);
	}
	throw new Error("GPT_EDITOR_PRIVATE_SELECTION_NOT_CONFIRMED");
}

async function waitForPrivateCreateAction(
	initialCreateButton?: HTMLElement,
): Promise<HTMLElement> {
	const control = privateVisibilityControl();
	const scopedRoot =
		control?.closest<HTMLElement>(
			'[role="dialog"], [role="menu"], [role="listbox"]',
		) ?? document;
	const labelGroups = [
		["Save", "保存"],
		["Publish", "发布"],
		["Create", "创建"],
	] as const;
	for (let attempt = 0; attempt < 40; attempt += 1) {
		for (const labels of labelGroups)
			for (const element of scopedRoot.querySelectorAll<HTMLElement>(
				'button, [role="button"]',
			))
				if (
					element !== initialCreateButton &&
					available(element) &&
					matchesBoundedSemantic(element, labels)
				)
					return element;
		await sleep(100);
	}
	throw new Error("GPT_EDITOR_PRIVATE_CREATE_ACTION_NOT_FOUND");
}

function publishCreateButton(): HTMLElement | null {
	return (
		[...document.querySelectorAll<HTMLElement>('button, [role="button"]')].find(
			(element) =>
				available(element) &&
				element.getAttribute("role") !== "radio" &&
				element.closest('[role="radiogroup"]') === null &&
				matchesExactSemantic(element, ["Create", "创建"]),
		) ?? null
	);
}

function fieldReadbackMatches(
	field: keyof typeof fieldLabels,
	expected: string,
): boolean {
	try {
		return controlValue(findControl(fieldLabels[field])) === expected;
	} catch {
		return false;
	}
}

function starterReadbackMatches(values: readonly string[]): boolean {
	const controls = conversationStarterControls(values.length);
	if (controls.length < values.length) return false;
	return values.every(
		(value, index) => controlValue(controls[index] as HTMLElement) === value,
	);
}

function modelReadbackValue(value: string): string | null {
	try {
		const selector = findControl([
			"Recommended model",
			"推荐模型",
			"推荐的模型",
			value,
		]);
		if (selector instanceof HTMLSelectElement) {
			const option = selector.selectedOptions[0];
			if (!option) return null;
			if (option.value === value) return option.value;
			const observed = (option.textContent ?? "").trim();
			if (observed === value) return observed;
			const trailing = /\(([^()]+)\)\s*$/.exec(observed)?.[1]?.trim();
			return trailing === value ? trailing : null;
		}
		for (const candidate of [
			selector.getAttribute("data-value"),
			selector.getAttribute("value"),
			selector.textContent,
		]) {
			if (!candidate) continue;
			const observed = candidate.trim();
			if (observed === value) return observed;
			const trailing = /\(([^()]+)\)\s*$/.exec(observed)?.[1]?.trim();
			if (trailing === value) return trailing;
		}
		return null;
	} catch {
		return null;
	}
}

function modelReadbackMatches(value: string): boolean {
	return modelReadbackValue(value) === value;
}

function capabilityReadbackMatches(
	capability: CustomGptCapability,
	expected: boolean,
): boolean {
	try {
		const control = findControl(capabilityLabels[capability]);
		if (control instanceof HTMLInputElement && control.type === "checkbox")
			return control.checked === expected;
		return (control.getAttribute("aria-checked") === "true") === expected;
	} catch {
		return false;
	}
}

function knowledgeReadbackMatches(name: string): boolean {
	const expected = normalize(name);
	return [
		...document.querySelectorAll<HTMLElement>('[role="group"], button'),
	].some(
		(element) =>
			normalize(element.getAttribute("aria-label")) === expected ||
			normalize(element.textContent) === expected,
	);
}

function actionReadbackMatches(schema: string): boolean {
	const match = /servers:\s*\n\s*-\s*url:\s*([^\s]+)/m.exec(schema);
	if (!match?.[1]) return false;
	try {
		const host = new URL(match[1]).host;
		return normalize(document.body.textContent).includes(normalize(host));
	} catch {
		return false;
	}
}

async function verifyConfiguredMaterial(
	material: CustomGptProvisioningRequest,
): Promise<void> {
	assertNoVisibleEditorFailure();
	await waitForReadback("GPT_EDITOR_NAME_READBACK_MISMATCH", () =>
		fieldReadbackMatches("displayName", material.displayName),
	);
	await waitForReadback("GPT_EDITOR_DESCRIPTION_READBACK_MISMATCH", () =>
		fieldReadbackMatches("description", material.description),
	);
	await waitForReadback("GPT_EDITOR_INSTRUCTIONS_READBACK_MISMATCH", () =>
		fieldReadbackMatches("instructions", material.instructions),
	);
	await waitForReadback("GPT_EDITOR_STARTERS_READBACK_MISMATCH", () =>
		starterReadbackMatches(material.conversationStarters),
	);
	await waitForReadback("GPT_EDITOR_MODEL_READBACK_MISMATCH", () =>
		modelReadbackMatches(material.recommendedModel),
	);
	for (const capability of [
		"webSearch",
		"imageGeneration",
		"codeInterpreter",
	] as const)
		await waitForReadback(
			`GPT_EDITOR_CAPABILITY_READBACK_MISMATCH:${capability}`,
			() =>
				capabilityReadbackMatches(
					capability,
					material.capabilities[capability],
				),
			);
	await waitForReadback("GPT_EDITOR_ACTION_READBACK_MISMATCH", () =>
		actionReadbackMatches(material.actionSchema),
	);
	for (const file of material.knowledgeFiles)
		await waitForReadback(
			`GPT_EDITOR_KNOWLEDGE_READBACK_MISMATCH:${file.name}`,
			() => knowledgeReadbackMatches(file.name),
			);
	await waitForReadback(
		"GPT_EDITOR_DRAFT_ID_NOT_READY",
		() => currentGptId() !== null,
	);
	assertNoVisibleEditorFailure();
}

function capabilityReadbackValue(capability: CustomGptCapability): boolean {
	const control = findControl(capabilityLabels[capability]);
	if (control instanceof HTMLInputElement && control.type === "checkbox")
		return control.checked;
	return control.getAttribute("aria-checked") === "true";
}

async function verifiedPublishedMaterial(material: CustomGptProvisioningRequest) {
	await verifyConfiguredMaterial(material);
	await openExistingActionEditor();
	const schema = actionSchemaControl();
	if (!schema) throw new Error("GPT_EDITOR_ACTION_SCHEMA_NOT_FOUND");
	const actionSchema = controlValue(schema);
	await returnFromActionEditor();
	const starters = conversationStarterControls(material.conversationStarters.length);
	if (starters.length < material.conversationStarters.length)
		throw new Error("GPT_EDITOR_STARTER_CONTROL_NOT_FOUND");
	const recommendedModel = modelReadbackValue(material.recommendedModel);
	if (!recommendedModel) throw new Error("GPT_EDITOR_MODEL_READBACK_MISMATCH");
	return {
		displayName: controlValue(findControl(fieldLabels.displayName)),
		description: controlValue(findControl(fieldLabels.description)),
		instructions: controlValue(findControl(fieldLabels.instructions)),
		actionSchema,
		conversationStarters: material.conversationStarters.map(
			(_value, index) => controlValue(starters[index] as HTMLElement),
		),
		recommendedModel,
		capabilities: {
			webSearch: capabilityReadbackValue("webSearch"),
			imageGeneration: capabilityReadbackValue("imageGeneration"),
			codeInterpreter: capabilityReadbackValue("codeInterpreter"),
		},
	};
}

async function updateExistingGpt() {
	assertNoVisibleEditorFailure();
	const expectedGptId = currentGptId();
	if (!expectedGptId) throw new Error("GPT_EDITOR_GPT_ID_MISSING");
	(await waitForAuthSemantic(document, ["Update", "更新"])).click();
	await waitForReadback("GPT_EDITOR_UPDATE_TIMEOUT", savedConfirmationVisible);
	const actualGptId = currentGptId();
	if (actualGptId !== expectedGptId) throw new Error("GPT_EDITOR_UPDATE_TARGET_MISMATCH");
	return { gptId: actualGptId, carrierUrl: `https://chatgpt.com/g/${actualGptId}` };
}

async function openPrivateCreateSurface(
	initialCreateButton: HTMLElement,
): Promise<void> {
	initialCreateButton.click();
	for (let attempt = 0; attempt < 200; attempt += 1) {
		if (privateVisibilityControl()) return;
		await sleep(100);
	}
	throw new Error("GPT_EDITOR_PRIVATE_CONTROL_NOT_FOUND");
}

async function waitForLiveCreatedResult() {
	for (let attempt = 0; attempt < 320; attempt += 1) {
		const gptId = currentGptId();
		if (gptId && savedConfirmationVisible())
			return { gptId, carrierUrl: `https://chatgpt.com/g/${gptId}` };
		await sleep(125);
	}
	throw new Error("GPT_EDITOR_PRIVATE_CREATE_TIMEOUT");
}

async function finalizePrivateCreateSurface(initialCreateButton?: HTMLElement) {
	await selectPrivateVisibility();
	(await waitForPrivateCreateAction(initialCreateButton)).click();
	return waitForLiveCreatedResult();
}

async function createPrivateGpt() {
	assertNoVisibleEditorFailure();
	const createButton = publishCreateButton();
	if (!createButton) throw new Error("GPT_EDITOR_FORM_READY_STATE_LOST");
	await openPrivateCreateSurface(createButton);
	return finalizePrivateCreateSurface(createButton);
}

const domPort: CustomGptEditorPort = {
	async setTextField(field, value) {
		setControlValue(findControl(fieldLabels[field]), value);
	},
	async replaceConversationStarters(values) {
		await replaceConversationStarters(values);
	},
	async selectRecommendedModel(value) {
		const selector = findControl([
			"Recommended model",
			"推荐模型",
			"推荐的模型",
			value,
		]);
		if (selector instanceof HTMLSelectElement) {
			let option: HTMLOptionElement | undefined;
			const normalizedValue = normalize(value);
			for (let attempt = 0; attempt < 150; attempt += 1) {
				option = [...selector.options].find((candidate) => {
					const optionText = normalize(candidate.textContent);
					return (
						candidate.value === value ||
						optionText === normalizedValue ||
						optionText.endsWith(`(${normalizedValue})`)
					);
				});
				if (option) break;
				await sleep(100);
			}
			if (!option)
				throw new Error(`GPT_EDITOR_MODEL_OPTION_NOT_FOUND:${value}`);
			setControlValue(selector, option.value);
			return;
		}
		selector.click();
		(await waitForClickable([value])).click();
	},
	async setCapability(capability, enabled) {
		const labels = capabilityLabels[capability];
		let control: HTMLElement;
		try {
			control = findControl(labels);
		} catch {
			control = await waitForClickable(labels);
		}
		if (control instanceof HTMLInputElement && control.type === "checkbox") {
			if (control.checked !== enabled) control.click();
			if (control.checked !== enabled)
				throw new Error(
					`GPT_EDITOR_CAPABILITY_READBACK_MISMATCH:${capability}`,
				);
			return;
		}
		if ((control.getAttribute("aria-checked") === "true") !== enabled)
			control.click();
		if ((control.getAttribute("aria-checked") === "true") !== enabled)
			throw new Error(`GPT_EDITOR_CAPABILITY_READBACK_MISMATCH:${capability}`);
	},
	async configureBearerAuth(value) {
		await configureBearerAuthDraft(value);
	},
	async uploadKnowledge(files) {
		await uploadKnowledge(files);
	},
	async verifyReady(material) {
		await verifyConfiguredMaterial(material);
	},
	async installActionSchema(value) {
		let schema = actionSchemaControl();
		if (!schema) {
			const create = clickable([
				"Create new action",
				"New action",
				"创建新操作",
			]);
			if (!create) throw new Error("GPT_EDITOR_ACTION_CREATE_NOT_FOUND");
			create.click();
			for (let attempt = 0; attempt < 200; attempt += 1) {
				schema = actionSchemaControl();
				if (schema) break;
				await sleep(100);
			}
		}
		if (!schema) throw new Error("GPT_EDITOR_ACTION_SCHEMA_NOT_FOUND");
		setControlValue(schema, value);
		await waitForReadback(
			"GPT_EDITOR_ACTION_SCHEMA_READBACK_MISMATCH",
			() => controlValue(schema as HTMLElement) === value,
		);
		assertNoVisibleEditorFailure();
		await returnFromActionEditor();
	},
	async createPrivate() {
		return createPrivateGpt();
	},
	async updateExisting() {
		return updateExistingGpt();
	},
};

const editorDriver = createCustomGptEditorDriver(domPort);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (message.type !== "PROFLOW_PROVISIONING_COMMAND") return;
	if (!editorSurfaceReady()) {
		sendResponse({ ok: false, error: "PROVISIONING_SURFACE_NOT_READY" });
		return;
	}
	void (async () => {
		try {
			await ensureConfigureMode();
			if (message.operation === "PROVISION_CUSTOM_GPT") {
				const material = parseCustomGptProvisioningRequest(message.request);
				const result = await editorDriver.provision(material);
				const published = await verifiedPublishedMaterial(material);
				sendResponse({
					ok: true,
					value: {
						...result,
						materialObservation: {
							contract: "proflow.role-carrier-material-observation.v1",
							source: "LIVE_CARRIER",
							roleRef: result.gptId,
							carrierUrl: result.carrierUrl,
							observedAt: new Date().toISOString(),
							material: published,
						},
						provisioningInstanceId: provisioningSurface.instanceId,
						url: location.href,
					},
				});
				return;
			}
			if (message.operation !== "FINALIZE_CUSTOM_GPT_AUTH")
				throw new Error("PROVISIONING_OPERATION_UNSUPPORTED");
			const expectedGptId = carrierGptId(message.request.carrierUrl);
			let credential = message.request.credential;
			delete message.request.credential;
			if (typeof credential !== "string" || credential.length < 32)
				throw new Error("ROLE_CREDENTIAL_INVALID");
			try {
				if (message.request.material !== undefined) {
					const material = parseCustomGptProvisioningRequest(message.request.material);
					const configured = { ...material, bearerCredential: credential };
					const result = await editorDriver.synchronizeExisting(configured);
					if (result.gptId !== expectedGptId)
						throw new Error("GPT_EDITOR_UPDATE_TARGET_MISMATCH");
					const published = await verifiedPublishedMaterial(configured);
					sendResponse({
						ok: true,
						value: {
							...result,
							materialObservation: {
								contract: "proflow.role-carrier-material-observation.v1",
								source: "LIVE_CARRIER",
								roleRef: result.gptId,
								carrierUrl: result.carrierUrl,
								observedAt: new Date().toISOString(),
								material: published,
							},
						},
					});
					return;
				}
				const result = await finalizeBearerAuth(credential);
				if (result.gptId !== expectedGptId)
					throw new Error("GPT_EDITOR_AUTH_TARGET_MISMATCH");
				sendResponse({ ok: true, value: result });
			} finally {
				credential = "";
			}
		} catch (error) {
			sendResponse({
				ok: false,
				error:
					error instanceof Error
						? error.message
						: "GPT_EDITOR_PROVISIONING_FAILED",
			});
		}
	})();
	return true;
});

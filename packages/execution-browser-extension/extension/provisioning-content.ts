import {
	type CustomGptCapability,
	type CustomGptEditorPort,
	type CustomGptKnowledgeFile,
	createCustomGptEditorDriver,
	parseCustomGptProvisioningRequest,
} from "../src/custom-gpt-editor-driver.js";

type ProvisioningSurface = {
	kind: "CUSTOM_GPT_DEPLOYMENT_PROVISIONING";
	instanceId: string;
	url: string;
};

type ProvisioningCommand =
	| {
			type: "PROFLOW_PROVISIONING_COMMAND";
			operation: "PROVISION_CUSTOM_GPT";
			request: Record<string, unknown>;
	  }
	| { type: "PROFLOW_PROVISIONING_FINALIZE_CREATE" };

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

async function replaceConversationStarters(values: readonly string[]) {
	const label = [...document.querySelectorAll<HTMLLabelElement>("label")].find(
		(element) => matchesAny(element, ["Conversation starter", "对话开场白"]),
	);
	if (!label) throw new Error("GPT_EDITOR_STARTER_CONTROL_NOT_FOUND");
	let scope: HTMLElement | null = label.parentElement;
	let controls: HTMLElement[] = [];
	for (let depth = 0; depth < 4 && scope; depth += 1) {
		controls = [
			...scope.querySelectorAll<HTMLElement>(
				'input[type="text"], textarea:not([data-testid="gizmo-instructions-input"])',
			),
		];
		if (controls.length >= values.length) break;
		scope = scope.parentElement;
	}
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
	for (let attempt = 0; attempt < 80; attempt += 1) {
		if ((document.body.textContent ?? "").includes(name)) return;
		await sleep(125);
	}
	throw new Error(`GPT_EDITOR_KNOWLEDGE_UPLOAD_TIMEOUT:${name}`);
}

async function uploadKnowledge(files: readonly CustomGptKnowledgeFile[]) {
	for (const descriptor of files) {
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
	"Invite-only",
	"Invite only",
	"只有我",
	"私有",
	"仅限受邀者",
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

async function waitForPublishCreateButton(attempts = 80): Promise<HTMLElement> {
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		const button = [
			...document.querySelectorAll<HTMLElement>('button, [role="button"]'),
		].find(
			(element) =>
				available(element) && matchesExactSemantic(element, ["Create", "创建"]),
		);
		if (button) return button;
		await sleep(100);
	}
	throw new Error("GPT_EDITOR_CREATE_BUTTON_NOT_FOUND");
}

async function openPrivateCreateSurface(
	initialCreateButton: HTMLElement,
): Promise<void> {
	const initialGptId = currentGptId();
	let publishTriggered = initialGptId !== undefined;
	initialCreateButton.click();
	for (let attempt = 0; attempt < 200; attempt += 1) {
		if (privateVisibilityControl()) return;
		if (!publishTriggered && currentGptId()) {
			(await waitForPublishCreateButton()).click();
			publishTriggered = true;
		}
		await sleep(100);
	}
	throw new Error("GPT_EDITOR_PRIVATE_CONTROL_NOT_FOUND");
}

async function waitForLiveCreatedResult() {
	for (let attempt = 0; attempt < 320; attempt += 1) {
		const gptId = currentGptId();
		const text = normalize(document.body.textContent);
		const saved =
			text.includes("settings saved") || text.includes("设置已保存");
		const liveMarker = clickable(["Update", "更新", "Share", "分享"]);
		if (gptId && (saved || liveMarker))
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
	const createButton = await waitForPublishCreateButton();
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
	async uploadKnowledge(files) {
		await uploadKnowledge(files);
	},
	async installActionSchema(value) {
		let schema: HTMLElement | null = null;
		try {
			schema = findControl(["OpenAPI schema", "Schema", "OpenAPI", "架构"]);
		} catch {
			const create = clickable([
				"Create new action",
				"New action",
				"创建新操作",
			]);
			if (!create) throw new Error("GPT_EDITOR_ACTION_CREATE_NOT_FOUND");
			create.click();
			for (let attempt = 0; attempt < 200; attempt += 1) {
				schema = document.querySelector<HTMLElement>(
					'textarea[placeholder*="OpenAPI"]',
				);
				if (schema) break;
				try {
					schema = findControl([
						"在此处输入你的 OpenAPI 架构",
						"OpenAPI schema",
						"Schema",
						"OpenAPI",
						"架构",
					]);
					break;
				} catch {
					await sleep(100);
				}
			}
		}
		if (!schema) throw new Error("GPT_EDITOR_ACTION_SCHEMA_NOT_FOUND");
		setControlValue(schema, value);
		await sleep(250);
		let back: HTMLButtonElement | undefined;
		for (let attempt = 0; attempt < 80; attempt += 1) {
			back = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
				(button) => {
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
		for (let attempt = 0; attempt < 80; attempt += 1) {
			if (
				[...document.querySelectorAll("label")].some((label) =>
					matchesAny(label, ["Knowledge", "知识"]),
				)
			)
				return;
			await sleep(100);
		}
		throw new Error("GPT_EDITOR_CONFIGURE_RETURN_TIMEOUT");
	},
	async createPrivate() {
		return createPrivateGpt();
	},
};

const editorDriver = createCustomGptEditorDriver(domPort);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (
		message.type !== "PROFLOW_PROVISIONING_COMMAND" &&
		message.type !== "PROFLOW_PROVISIONING_FINALIZE_CREATE"
	)
		return;
	if (!editorSurfaceReady()) {
		sendResponse({ ok: false, error: "PROVISIONING_SURFACE_NOT_READY" });
		return;
	}
	void (async () => {
		try {
			const result =
				message.type === "PROFLOW_PROVISIONING_FINALIZE_CREATE"
					? await finalizePrivateCreateSurface()
					: await (async () => {
							await ensureConfigureMode();
							const material = parseCustomGptProvisioningRequest(
								message.request,
							);
							return editorDriver.provision(material);
						})();
			sendResponse({
				ok: true,
				value: {
					...result,
					provisioningInstanceId: provisioningSurface.instanceId,
					url: location.href,
				},
			});
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

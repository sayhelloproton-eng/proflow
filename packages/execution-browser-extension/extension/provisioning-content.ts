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

type ProvisioningCommand = {
	type: "PROFLOW_PROVISIONING_COMMAND";
	operation: "PROVISION_CUSTOM_GPT" | "FINALIZE_CUSTOM_GPT_AUTH";
	request: Record<string, unknown>;
};

type ChromeRuntime = {
	runtime: {
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
	const nested = label.querySelector<HTMLElement>(
		'input, textarea, [contenteditable="true"], [role="textbox"], [role="combobox"]',
	);
	return nested;
}

function findControl(candidates: readonly string[]): HTMLElement {
	for (const label of document.querySelectorAll("label"))
		if (matchesAny(label, candidates)) {
			const control = controlFromLabel(label);
			if (control) return control;
		}
	for (const element of document.querySelectorAll<HTMLElement>(
		'input, textarea, [contenteditable="true"], [role="textbox"], [role="combobox"]',
	))
		if (matchesAny(element, candidates)) return element;
	throw new Error(`GPT_EDITOR_CONTROL_NOT_FOUND:${candidates[0] ?? "unknown"}`);
}

function setControlValue(element: HTMLElement, value: string): void {
	if (
		element instanceof HTMLInputElement ||
		element instanceof HTMLTextAreaElement
	) {
		const prototype =
			element instanceof HTMLInputElement
				? HTMLInputElement.prototype
				: HTMLTextAreaElement.prototype;
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
	displayName: ["Name", "名称"],
	description: ["Description", "描述"],
	instructions: ["Instructions", "指令"],
} as const;

const capabilityLabels: Record<CustomGptCapability, readonly string[]> = {
	webSearch: ["Web search", "网页搜索", "网络搜索"],
	imageGeneration: ["Image generation", "图像生成"],
	codeInterpreter: [
		"Code Interpreter & Data Analysis",
		"Code Interpreter",
		"Data Analysis",
		"代码解释器",
	],
};

async function replaceConversationStarters(values: readonly string[]) {
	let controls = [
		...document.querySelectorAll<HTMLElement>("input, textarea"),
	].filter((element) =>
		matchesAny(element, ["Conversation starter", "对话开场白"]),
	);
	while (controls.length < values.length) {
		const add = clickable([
			"Add conversation starter",
			"Add starter",
			"添加对话开场白",
		]);
		if (!add) break;
		add.click();
		await sleep(100);
		controls = [
			...document.querySelectorAll<HTMLElement>("input, textarea"),
		].filter((element) =>
			matchesAny(element, ["Conversation starter", "对话开场白"]),
		);
	}
	if (controls.length < values.length)
		throw new Error("GPT_EDITOR_STARTER_CONTROL_NOT_FOUND");
	for (let index = 0; index < controls.length; index += 1)
		setControlValue(controls[index] as HTMLElement, values[index] ?? "");
}

function currentGptId(): string | null {
	const match = /\/(g-[a-zA-Z0-9_-]+)(?:\/|$)/.exec(location.pathname);
	return match?.[1] ?? null;
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

async function knowledgeFileInput(): Promise<HTMLInputElement> {
	let input = document.querySelector<HTMLInputElement>('input[type="file"]');
	if (input) return input;
	const upload = clickable([
		"Upload files",
		"Upload file",
		"Add files",
		"上传文件",
		"添加文件",
	]);
	if (upload) upload.click();
	for (let attempt = 0; attempt < 40; attempt += 1) {
		input = document.querySelector<HTMLInputElement>('input[type="file"]');
		if (input) return input;
		await sleep(100);
	}
	throw new Error("GPT_EDITOR_KNOWLEDGE_INPUT_NOT_FOUND");
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
		const response = await fetch(descriptor.url, { cache: "no-store" });
		if (!response.ok)
			throw new Error(`KNOWLEDGE_RELAY_FETCH_FAILED:${response.status}`);
		const bytes = await response.arrayBuffer();
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

async function createPrivateGpt() {
	(await waitForClickable(["Create", "创建"])).click();
	const onlyMe = await waitForClickable(["Only me", "只有我"]);
	const checked = onlyMe.getAttribute("aria-checked");
	if (checked !== "true") onlyMe.click();
	(await waitForClickable(["Save", "保存"])).click();
	for (let attempt = 0; attempt < 80; attempt += 1) {
		const gptId = currentGptId();
		const liveMarker = clickable(["Update", "更新", "Share", "分享"]);
		if (gptId && liveMarker)
			return { gptId, carrierUrl: `https://chatgpt.com/g/${gptId}` };
		await sleep(125);
	}
	throw new Error("GPT_EDITOR_PRIVATE_CREATE_TIMEOUT");
}

function dialogClickable(candidates: readonly string[]): HTMLElement | null {
	const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
	if (!dialog) return null;
	for (const element of dialog.querySelectorAll<HTMLElement>(
		'button, [role="button"], [role="radio"]',
	))
		if (matchesAny(element, candidates)) return element;
	return null;
}

async function waitForDialogClickable(candidates: readonly string[]) {
	for (let attempt = 0; attempt < 40; attempt += 1) {
		const element = dialogClickable(candidates);
		if (element) return element;
		await sleep(100);
	}
	throw new Error(
		`GPT_EDITOR_AUTH_CONTROL_NOT_FOUND:${candidates[0] ?? "unknown"}`,
	);
}

async function finalizeBearerAuth(credential: string) {
	if (credential.length < 32) throw new Error("ROLE_CREDENTIAL_INVALID");
	(await waitForClickable(["Authentication", "身份验证", "认证"])).click();
	const apiKey = await waitForDialogClickable(["API Key", "API 密钥"]);
	if (apiKey.getAttribute("aria-checked") !== "true") apiKey.click();
	const bearer = await waitForDialogClickable(["Bearer"]);
	if (bearer.getAttribute("aria-checked") !== "true") bearer.click();
	const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
	if (!dialog) throw new Error("GPT_EDITOR_AUTH_DIALOG_NOT_FOUND");
	const keyInput = dialog.querySelector<HTMLInputElement>(
		'input:not([type="radio"]):not([type="checkbox"]):not([type="hidden"])',
	);
	if (!keyInput) throw new Error("GPT_EDITOR_AUTH_KEY_INPUT_NOT_FOUND");
	setControlValue(keyInput, credential);
	(await waitForDialogClickable(["Save", "保存"])).click();
	(await waitForClickable(["Update", "更新"])).click();
	for (let attempt = 0; attempt < 80; attempt += 1) {
		const text = normalize(document.body.textContent);
		if (text.includes("settings saved") || text.includes("设置已保存")) {
			const gptId = currentGptId();
			if (!gptId) throw new Error("GPT_EDITOR_GPT_ID_MISSING");
			return { status: "AUTH_UPDATED" as const, gptId };
		}
		await sleep(125);
	}
	throw new Error("GPT_EDITOR_AUTH_UPDATE_TIMEOUT");
}

const domPort: CustomGptEditorPort = {
	async setTextField(field, value) {
		setControlValue(findControl(fieldLabels[field]), value);
	},
	async replaceConversationStarters(values) {
		await replaceConversationStarters(values);
	},
	async selectRecommendedModel(value) {
		const selector = findControl(["Recommended model", "推荐模型", value]);
		selector.click();
		const option = await waitForClickable([value]);
		option.click();
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
			return;
		}
		const checked = control.getAttribute("aria-checked");
		if ((checked === "true") !== enabled) control.click();
	},
	async uploadKnowledge(files) {
		await uploadKnowledge(files);
	},
	async installActionSchema(value) {
		let schema: HTMLElement | null = null;
		try {
			schema = findControl(["OpenAPI schema", "Schema", "OpenAPI"]);
		} catch {
			const create = clickable([
				"Create new action",
				"New action",
				"创建新操作",
			]);
			if (create) {
				create.click();
				await sleep(150);
				schema = findControl(["OpenAPI schema", "Schema", "OpenAPI"]);
			}
		}
		if (!schema) throw new Error("GPT_EDITOR_ACTION_SCHEMA_NOT_FOUND");
		setControlValue(schema, value);
	},
	async createPrivate() {
		return createPrivateGpt();
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
			if (message.operation === "PROVISION_CUSTOM_GPT") {
				const material = parseCustomGptProvisioningRequest(message.request);
				const result = await editorDriver.provision(material);
				sendResponse({
					ok: true,
					value: {
						...result,
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

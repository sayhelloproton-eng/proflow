export {};

type ChromeOptions = {
	runtime: {
		id: string;
		getManifest(): { version: string };
		reload(): void;
	};
	storage: {
		local: {
			get(key: string): Promise<Record<string, unknown>>;
			set(value: Record<string, unknown>): Promise<void>;
		};
	};
};
declare const chrome: ChromeOptions;

type LocalConfigForm = {
	storageKey:
		| "proflowRuntimeBridge"
		| "proflowTaskApplication"
		| "proflowApprovalApplication";
	formId: string;
	endpointId: string;
	tokenId: string;
	statusId: string;
};

type AutomationAction = "probe" | "reload";

function parseEndpoint(raw: string): string {
	const parsed = new URL(raw);
	if (
		parsed.protocol !== "http:" ||
		parsed.hostname !== "127.0.0.1" ||
		parsed.pathname !== "/" ||
		parsed.search !== "" ||
		parsed.hash !== ""
	)
		throw new Error("Endpoint must be a loopback HTTP origin");
	return raw.replace(/\/$/, "");
}

function automationCallback(params: URLSearchParams): {
	action: AutomationAction;
	callback: URL;
	nonce: string;
} | null {
	const rawAction = params.get("proflowAutomation");
	if (rawAction === null) return null;
	if (rawAction !== "probe" && rawAction !== "reload")
		throw new Error("AUTOMATION_ACTION_INVALID");
	if (params.get("extensionId") !== chrome.runtime.id)
		throw new Error("AUTOMATION_EXTENSION_ID_MISMATCH");
	const nonce = params.get("nonce") ?? "";
	if (!/^[a-f0-9-]{16,64}$/i.test(nonce)) throw new Error("AUTOMATION_NONCE_INVALID");
	const rawCallback = params.get("callback");
	if (!rawCallback) throw new Error("AUTOMATION_CALLBACK_MISSING");
	const callback = new URL(rawCallback);
	if (
		callback.protocol !== "http:" ||
		callback.hostname !== "127.0.0.1" ||
		callback.port === "" ||
		callback.username !== "" ||
		callback.password !== "" ||
		callback.search !== "" ||
		callback.hash !== "" ||
		callback.pathname !== `/proflow-extension/${nonce}`
	)
		throw new Error("AUTOMATION_CALLBACK_INVALID");
	return { action: rawAction, callback, nonce };
}

async function runAutomationRequest(): Promise<void> {
	const request = automationCallback(new URLSearchParams(location.search));
	if (!request) return;
	const response = await fetch(request.callback, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			contract: "proflow.browser-extension.self-reload.v1",
			action: request.action,
			extensionId: chrome.runtime.id,
			version: chrome.runtime.getManifest().version,
		}),
	});
	if (!response.ok) throw new Error("AUTOMATION_CALLBACK_REJECTED");
	document.documentElement.dataset.proflowAutomation = `${request.action}-acknowledged`;
	if (request.action === "reload") {
		setTimeout(() => chrome.runtime.reload(), 50);
		return;
	}
	setTimeout(() => window.close(), 50);
}

function wireConfigForm(config: LocalConfigForm) {
	const endpoint = document.querySelector<HTMLInputElement>(
		`#${config.endpointId}`,
	);
	const token = document.querySelector<HTMLInputElement>(`#${config.tokenId}`);
	const status = document.querySelector<HTMLElement>(`#${config.statusId}`);
	const form = document.querySelector<HTMLFormElement>(`#${config.formId}`);
	if (!endpoint || !token || !status || !form)
		throw new Error("OPTIONS_DOM_INVALID");

	void chrome.storage.local.get(config.storageKey).then((stored) => {
		const value = stored[config.storageKey];
		if (typeof value !== "object" || value === null) return;
		const record = value as Record<string, unknown>;
		if (typeof record.endpoint === "string") endpoint.value = record.endpoint;
	});

	form.addEventListener("submit", (event) => {
		event.preventDefault();
		void (async () => {
			const normalizedEndpoint = parseEndpoint(endpoint.value);
			if (token.value.length < 32) throw new Error("Token is too short");
			await chrome.storage.local.set({
				[config.storageKey]: {
					endpoint: normalizedEndpoint,
					token: token.value,
				},
			});
			token.value = "";
			status.textContent = "Saved.";
		})().catch((error: unknown) => {
			status.textContent =
				error instanceof Error ? error.message : "Save failed";
		});
	});
}

document.querySelector<HTMLElement>("#extension-id")?.append(chrome.runtime.id);

wireConfigForm({
	storageKey: "proflowRuntimeBridge",
	formId: "bridge-form",
	endpointId: "bridge-endpoint",
	tokenId: "bridge-token",
	statusId: "bridge-status",
});
wireConfigForm({
	storageKey: "proflowTaskApplication",
	formId: "task-application-form",
	endpointId: "task-application-endpoint",
	tokenId: "task-application-token",
	statusId: "task-application-status",
});

wireConfigForm({
	storageKey: "proflowApprovalApplication",
	formId: "approval-application-form",
	endpointId: "approval-application-endpoint",
	tokenId: "approval-application-token",
	statusId: "approval-application-status",
});

void runAutomationRequest().catch((error: unknown) => {
	document.documentElement.dataset.proflowAutomation = "failed";
	const status = document.querySelector<HTMLElement>("#bridge-status");
	if (status)
		status.textContent =
			error instanceof Error ? error.message : "Automation request failed";
});

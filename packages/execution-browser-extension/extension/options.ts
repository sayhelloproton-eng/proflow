export {};

type ChromeOptions = {
	runtime: { id: string };
	storage: {
		local: {
			get(key: string): Promise<Record<string, unknown>>;
			set(value: Record<string, unknown>): Promise<void>;
		};
	};
};
declare const chrome: ChromeOptions;

type LocalConfigForm = {
	storageKey: "proflowRuntimeBridge" | "proflowTaskApplication";
	formId: string;
	endpointId: string;
	tokenId: string;
	statusId: string;
};

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

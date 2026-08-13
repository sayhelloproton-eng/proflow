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

const endpoint = document.querySelector<HTMLInputElement>("#endpoint");
const token = document.querySelector<HTMLInputElement>("#token");
const status = document.querySelector<HTMLElement>("#status");
const form = document.querySelector<HTMLFormElement>("#bridge-form");
if (!endpoint || !token || !status || !form)
	throw new Error("OPTIONS_DOM_INVALID");

document.querySelector<HTMLElement>("#extension-id")?.append(chrome.runtime.id);

void chrome.storage.local.get("proflowRuntimeBridge").then((stored) => {
	const config = stored.proflowRuntimeBridge;
	if (typeof config !== "object" || config === null) return;
	const record = config as Record<string, unknown>;
	if (typeof record.endpoint === "string") endpoint.value = record.endpoint;
});

form.addEventListener("submit", (event) => {
	event.preventDefault();
	void (async () => {
		const parsed = new URL(endpoint.value);
		if (
			parsed.protocol !== "http:" ||
			parsed.hostname !== "127.0.0.1" ||
			parsed.pathname !== "/" ||
			parsed.search !== "" ||
			parsed.hash !== ""
		)
			throw new Error("Endpoint must be a loopback HTTP origin");
		if (token.value.length < 32) throw new Error("Token is too short");
		await chrome.storage.local.set({
			proflowRuntimeBridge: {
				endpoint: endpoint.value.replace(/\/$/, ""),
				token: token.value,
			},
		});
		token.value = "";
		status.textContent =
			"Saved. Reload the extension to start a fresh session.";
	})().catch((error: unknown) => {
		status.textContent = error instanceof Error ? error.message : "Save failed";
	});
});

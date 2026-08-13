export {};

type ChromePanel = {
	runtime: { sendMessage(message: unknown): Promise<unknown> };
};
declare const chrome: ChromePanel;

const target = document.querySelector("#status");
if (!(target instanceof HTMLElement))
	throw new Error("SIDE_PANEL_TARGET_MISSING");
const statusTarget = target;

async function refresh() {
	const snapshot = await chrome.runtime.sendMessage({
		type: "PROFLOW_SIDE_PANEL_SNAPSHOT",
	});
	statusTarget.textContent = JSON.stringify(snapshot, null, 2);
}

void refresh();
setInterval(() => {
	void refresh();
}, 2_000);

import type { BrowserBridgeCommand } from "./browser-session-lane.js";
import type { PageRealityController } from "./page-reality-controller.js";
import type { PermissionController } from "./permission-controller.js";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numeric(value: unknown, name: string): number {
	if (!Number.isInteger(value)) throw new Error(`${name}_INVALID`);
	return value as number;
}

function text(value: unknown, name: string): string {
	if (typeof value !== "string" || value.length === 0)
		throw new Error(`${name}_INVALID`);
	return value;
}

export function createBrowserCommandController(options: {
	page: PageRealityController;
	permissions: PermissionController;
	sleep(milliseconds: number): Promise<void>;
}) {
	return Object.freeze({
		async execute(command: BrowserBridgeCommand): Promise<unknown> {
			if (command.type === "WAKE_GUARD") {
				return {
					allowed: options.permissions.guardWake({
						taskId: text(command.taskId, "TASK_ID"),
						roleRef: text(command.roleRef, "ROLE_REF"),
						workerRef: text(command.workerRef, "WORKER_REF"),
						conversationLocator: text(
							command.conversationLocator,
							"CONVERSATION_LOCATOR",
						),
					}),
				};
			}
			if (command.type === "CARRIER_ATTENTION_ACTION") {
				if (command.action !== "allowOnce" && command.action !== "deny")
					throw new Error("ATTENTION_ACTION_INVALID");
				return options.permissions.decideAttention(
					text(command.attentionRef, "ATTENTION_REF"),
					command.action,
				);
			}
			if (command.type === "LIST_TABS") return options.page.listObservedTabs();
			if (command.type === "OPEN") return options.page.open(text(command.url, "URL"));
			const tabId = numeric(command.tabId, "TAB_ID");
			if (command.type === "OBSERVE") return options.page.observe(tabId);
			if (command.type === "SUBMIT") {
				const before = options.page.current(tabId);
				const fingerprint = text(command.fingerprint, "FINGERPRINT");
				if (command.wakeGuard && !options.permissions.guardWake(command.wakeGuard))
					throw new Error("CARRIER_CONTINUATION_HUMAN_DENIED");
				try {
					await options.page.contentCommand(tabId, {
						operation: "submit",
						value: text(command.text, "TEXT"),
						fingerprint,
					});
				} catch (error) {
					const replacement = await options.page
						.waitForObservation(
							tabId,
							(value) => value.contentInstanceId !== before.contentInstanceId,
						)
						.catch(() => null);
					if (!replacement) throw error;
				}
				return options.page.waitForSubmittedMessage(tabId, fingerprint);
			}
			if (command.type === "VERIFY")
				return options.page.contentCommand(tabId, {
					operation: "verify",
					fingerprint: text(command.fingerprint, "FINGERPRINT"),
				});
			if (command.type === "SCREENSHOT") return options.page.screenshot(tabId);
			const request = command.request;
			if (!isRecord(request) || !isRecord(request.input))
				throw new Error("EXECUTION_REQUEST_INVALID");
			const capability = text(request.capability, "CAPABILITY");
			if (capability === "browser.navigate")
				return options.page.navigate(tabId, text(request.input.url, "URL"));
			if (capability === "browser.input" || capability === "browser.click") {
				await options.page.contentCommand(tabId, {
					operation: capability === "browser.input" ? "input" : "click",
					selector: text(request.input.selector, "SELECTOR"),
					...(capability === "browser.input"
						? { value: text(request.input.value, "VALUE") }
						: {}),
				});
				return options.page.waitForObservation(tabId);
			}
			if (capability === "browser.submit") {
				await options.page.contentCommand(tabId, {
					operation: "submit",
					...(typeof request.input.selector === "string"
						? { selector: request.input.selector }
						: {}),
					value: text(request.input.fingerprint, "FINGERPRINT"),
					fingerprint: text(request.input.fingerprint, "FINGERPRINT"),
				});
				return options.page.waitForObservation(tabId);
			}
			if (capability === "browser.wait") {
				const timeoutMs = numeric(request.input.timeoutMs, "TIMEOUT");
				const end = Date.now() + timeoutMs;
				while (Date.now() < end) {
					const observed = await options.page.contentCommand(tabId, {
						operation: "observe",
					});
					if (isRecord(observed) && observed.pageState === "IDLE") return observed;
					await options.sleep(250);
				}
				throw new Error("WAIT_TIMEOUT");
			}
			throw new Error("BROWSER_PRIMITIVE_UNAVAILABLE");
		},
	});
}

import {
	createBrowserReconnectOwner,
	restoreBrowserSessionIdentity,
} from "../src/browser-session-reconnect.js";
import { shouldTriggerObserverRecovery } from "../src/recovery-trigger.js";
import {
	createApplicationClient,
	normalizeLogErrorCode,
	structuredAxes,
} from "./runtime/application-client.js";
import { createBrowserCommandController } from "./runtime/browser-command-controller.js";
import { createBrowserSessionLane } from "./runtime/browser-session-lane.js";
import type { ChromeRuntime, ContentObservation } from "./runtime/chrome-runtime.js";
import { createLocalToolLane } from "./runtime/local-tool-lane.js";
import { createObserverRecoveryController } from "./runtime/observer-recovery-controller.js";
import { createPageRealityController } from "./runtime/page-reality-controller.js";
import { createPermissionController } from "./runtime/permission-controller.js";
import { createProvisioningLane } from "./runtime/provisioning-lane.js";
import { createRuntimeMessageRouter } from "./runtime/runtime-message-router.js";
import { createTaskPageController } from "./runtime/task-page-controller.js";

declare const chrome: ChromeRuntime;

let extensionInstanceId = `extension:${crypto.randomUUID()}`;
const extensionModuleVersion = chrome.runtime.getManifest().version;
const sleep = (milliseconds: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const applications = createApplicationClient({
	storageLocal: chrome.storage.local,
	runtimeConfigUrl: chrome.runtime.getURL("runtime-config.json"),
});

const page = createPageRealityController({ tabs: chrome.tabs, sleep });
const permissions = createPermissionController({
	storageSession: chrome.storage.session,
	page,
	getExtensionInstanceId: () => extensionInstanceId,
	invokeObserver: applications.invokeObserver,
	publishCarrierAttentions: applications.publishCarrierAttentions,
	sleep,
});

const observerRecovery = createObserverRecoveryController({
	storage: chrome.storage.local,
	invokeObserver: applications.invokeObserver,
	emitDiagnostic(status, attemptNo, operationRef) {
		void applications
			.emitLog({
				level: "INFO",
				component: "browser-observer-recovery",
				operation: "observer.recovery",
				status,
				attemptNo,
				operationRef,
			})
			.catch(() => undefined);
	},
});

function processContentObservation(
	observed: ContentObservation,
	triggerRecovery: boolean,
): void {
	const previous = page.record(observed);
	void permissions.observe(observed);
	const shouldRecover =
		triggerRecovery && shouldTriggerObserverRecovery(previous, observed);
	const suppressed =
		shouldRecover && permissions.suppressRecovery(previous, observed);
	if (shouldRecover && !suppressed) void observerRecovery.requestRecovery();
}

const browserCommands = createBrowserCommandController({
	page,
	permissions,
	sleep,
});

const localToolLane = createLocalToolLane({
	config: applications.localToolBridgeConfig,
	getExtensionInstanceId: () => extensionInstanceId,
	extensionId: chrome.runtime.id,
	moduleVersion: extensionModuleVersion,
	fetchBridge: applications.fetchBridge,
	sleep,
	async createNotification(id, input) {
		await chrome.notifications.create(id, { type: "basic", ...input });
	},
	setBadgeText: (value) => chrome.action.setBadgeText({ text: value }),
	setTitle: (value) => chrome.action.setTitle({ title: value }),
});

const provisioningLane = createProvisioningLane({
	config: applications.provisioningBridgeConfig,
	getExtensionInstanceId: () => extensionInstanceId,
	extensionId: chrome.runtime.id,
	fetchBridge: applications.fetchBridge,
	sleep,
	openTab: (url) => chrome.tabs.create({ url, active: true }),
	getTab: (tabId) => chrome.tabs.get(tabId),
	reloadTab: (tabId) => chrome.tabs.reload(tabId),
	sendTabMessage: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
});

const browserSessionLane = createBrowserSessionLane({
	config: applications.bridgeConfig,
	getExtensionInstanceId: () => extensionInstanceId,
	extensionId: chrome.runtime.id,
	moduleVersion: extensionModuleVersion,
	fetchBridge: applications.fetchBridge,
	sleep,
	async keepalive() {
		await chrome.storage.session
			.get("proflowBrowserSnapshot")
			.catch(() => ({}));
	},
	publishCarrierAttentions: permissions.publish,
	onSessionEstablished: observerRecovery.bridgeSessionEstablished,
	executeCommand: browserCommands.execute,
	logCommandResult(command, result) {
		void applications.emitLog({
			level: result.ok ? "INFO" : "WARN",
			component: "browser-carrier",
			operation: command.type,
			operationRef: command.commandId,
			status: result.ok ? "SUCCEEDED" : "FAILED",
			...(result.error
				? {
						errorCode: normalizeLogErrorCode(
							result.error,
							"EXTENSION_COMMAND_FAILED",
						),
					}
				: {}),
			...(command.tabId === undefined ? {} : { tabId: command.tabId }),
			...(command.request && typeof command.request === "object"
				? {
						...(typeof command.request.capability === "string"
							? { capability: command.request.capability }
							: {}),
						...structuredAxes(command.request),
					}
				: {}),
		});
	},
});

const runtimeMessages = createRuntimeMessageRouter({
	getExtensionInstanceId: () => extensionInstanceId,
	page,
	permissions,
	onObservation: (observed) => processContentObservation(observed, true),
	taskApplicationConfig: applications.taskApplicationConfig,
	approvalApplicationConfig: applications.approvalApplicationConfig,
	loadObserverState: observerRecovery.loadState,
	invokeTask: applications.invokeTask,
	invokeApproval: applications.invokeApproval,
});
chrome.runtime.onMessage.addListener(runtimeMessages.handle);

const taskPage = createTaskPageController({
	bridgeConfig: applications.bridgeConfig,
	fetchBridge: applications.fetchBridge,
	tabs: chrome.tabs,
	fallbackUrl: () => chrome.runtime.getURL("extension/tasks.html"),
});
chrome.action.onClicked.addListener(() => void taskPage.open());

let backgroundInitialization: Promise<void> | null = null;
function initializeBackgroundRuntime(): Promise<void> {
	if (backgroundInitialization) return backgroundInitialization;
	backgroundInitialization = (async () => {
		await permissions.restore();
		await applications.bootstrap();
		extensionInstanceId = await restoreBrowserSessionIdentity(
			chrome.storage.session,
			chrome.runtime.id,
			extensionModuleVersion,
			() => `extension:${crypto.randomUUID()}`,
		);
		await permissions.persist();
		void localToolLane.start();
		void provisioningLane.start();
		void page
			.recoverObservations()
			.then(async (observations) => {
				for (const observed of observations) {
					processContentObservation(observed, false);
					permissions.consumeRecovery(undefined, observed);
				}
				await permissions.persist();
				await permissions.publish().catch(() => undefined);
				observerRecovery.startupReady();
			})
			.catch(() => undefined);
	})().catch((error: unknown) => {
		backgroundInitialization = null;
		throw error;
	});
	return backgroundInitialization;
}

const browserReconnect = createBrowserReconnectOwner({
	now: Date.now,
	sleep,
	async runSession(online) {
		await initializeBackgroundRuntime();
		await browserSessionLane.run(online);
	},
});

const reconnectAlarm = "proflow-browser-session-reconnect";
let backgroundStart: Promise<void> | null = null;
function startBackgroundRuntime(): Promise<void> {
	if (backgroundStart) return backgroundStart;
	backgroundStart = (async () => {
		if (!(await chrome.alarms.get(reconnectAlarm)))
			await chrome.alarms.create(reconnectAlarm, { periodInMinutes: 1 });
		await browserReconnect.start();
	})().finally(() => {
		backgroundStart = null;
	});
	return backgroundStart;
}
function requestBackgroundStart(): void {
	void startBackgroundRuntime().catch(() => {
		console.warn("PROFLOW_BROWSER_RECONNECT_START_FAILED");
	});
}

chrome.alarms.onAlarm.addListener((alarm) => {
	if (alarm.name === reconnectAlarm) requestBackgroundStart();
});
chrome.runtime.onInstalled.addListener(requestBackgroundStart);
chrome.runtime.onStartup.addListener(requestBackgroundStart);
requestBackgroundStart();

import {
	createBrowserReconnectOwner,
	restoreBrowserSessionIdentity,
} from "../src/browser-session-reconnect.js";
import { PAGE_PERMISSION_WATCHDOG_INTERVAL_MS } from "../src/page-permission-watchdog.js";
import { shouldTriggerObserverRecovery } from "../src/recovery-trigger.js";
import { createApplicationClient } from "./runtime/application-client.js";
import { createBrowserCommandController } from "./runtime/browser-command-controller.js";
import { createBrowserSessionLane } from "./runtime/browser-session-lane.js";
import type {
	ChromeRuntime,
	ContentObservation,
} from "./runtime/chrome-runtime.js";
import { createExtensionLogger } from "./runtime/extension-logger.js";
import { createLocalToolLane } from "./runtime/local-tool-lane.js";
import { createObserverRecoveryController } from "./runtime/observer-recovery-controller.js";
import { createExtensionOperationObserver } from "./runtime/operation-observer.js";
import { createPageRealityController } from "./runtime/page-reality-controller.js";
import { createPageRealityRecoveryLoop } from "./runtime/page-reality-watchdog.js";
import { createPermissionActionLoggingPage } from "./runtime/permission-action-page.js";
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
const operationLogger = createExtensionLogger({
	storage: chrome.storage.local,
	getExtensionInstanceId: () => extensionInstanceId,
	moduleVersion: extensionModuleVersion,
	remoteWrite: applications.emitLog,
});
const observability = createExtensionOperationObserver({
	logger: operationLogger,
});
// Logging-only retry: never replays a command or a business effect.
setInterval(() => {
	void operationLogger.flush();
}, 30_000);
const invokeObserver = observability.wrapHostApplication(
	"observer",
	applications.invokeObserver,
);
const invokeTask = observability.wrapHostApplication(
	"task",
	applications.invokeTask,
);
const invokeApproval = observability.wrapHostApplication(
	"approval",
	applications.invokeApproval,
);

const page = createPageRealityController({
	tabs: chrome.tabs,
	sleep,
	async injectContentScript(tabId) {
		await chrome.scripting.executeScript({
			target: { tabId },
			files: ["dist/extension/content.js"],
		});
	},
});
const permissionPage = createPermissionActionLoggingPage({
	page,
	logger: operationLogger,
	now: () => performance.now(),
});
const permissions = createPermissionController({
	storageSession: chrome.storage.session,
	page: permissionPage,
	getExtensionInstanceId: () => extensionInstanceId,
	invokeObserver,
	publishCarrierAttentions: applications.publishCarrierAttentions,
	sleep,
});

const observerRecovery = createObserverRecoveryController({
	storage: chrome.storage.local,
	invokeObserver,
	emitDiagnostic: observability.recovery,
});

function processContentObservation(
	observed: ContentObservation,
	triggerRecovery: boolean,
): void {
	const previous = page.record(observed);
	observability.pageTransition(previous, observed);
	void permissions.observe(observed).then(
		(outcome) => {
			if (outcome) observability.permission(outcome);
		},
		(error) => observability.permissionFailure(observed, error),
	);
	const shouldRecover =
		triggerRecovery && shouldTriggerObserverRecovery(previous, observed);
	const suppressed =
		shouldRecover && permissions.suppressRecovery(previous, observed);
	if (shouldRecover && !suppressed) void observerRecovery.requestRecovery();
}

const pageRealityRecovery = createPageRealityRecoveryLoop({
	intervalMs: PAGE_PERMISSION_WATCHDOG_INTERVAL_MS,
	schedule(callback, intervalMs) {
		return setInterval(callback, intervalMs);
	},
	async recover() {
		const observations = await page.recoverObservations();
		for (const observed of observations) {
			processContentObservation(observed, false);
			permissions.consumeRecovery(undefined, observed);
		}
		await permissions.persist();
		await permissions.publish().catch(() => undefined);
	},
});

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
	onSessionState: observability.localToolSession,
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
	onSessionState: observability.provisioningSession,
	onCommandSettled: observability.provisioningCommand,
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
	onSessionState: observability.browserSession,
	onCommandSettled: observability.browserCommand,
	executeCommand: browserCommands.execute,
});

const runtimeMessages = createRuntimeMessageRouter({
	getExtensionInstanceId: () => extensionInstanceId,
	page,
	permissions,
	onObservation: (observed) => processContentObservation(observed, true),
	taskApplicationConfig: applications.taskApplicationConfig,
	approvalApplicationConfig: applications.approvalApplicationConfig,
	loadObserverState: observerRecovery.loadState,
	observabilitySnapshot: observability.snapshot,
	invokeTask,
	invokeApproval,
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
	const started = performance.now();
	backgroundInitialization = (async () => {
		await permissions.restore();
		await applications.bootstrap();
		extensionInstanceId = await restoreBrowserSessionIdentity(
			chrome.storage.session,
			chrome.runtime.id,
			extensionModuleVersion,
			() => `extension:${crypto.randomUUID()}`,
		);
		void operationLogger.flush();
		await permissions.persist();
		void localToolLane.start();
		void provisioningLane.start();
		pageRealityRecovery.start();
		void pageRealityRecovery
			.run()
			.then(() => observerRecovery.startupReady())
			.catch(() => undefined);
		observability.lifecycle({
			operationId: "INITIALIZE",
			status: "SUCCEEDED",
			durationMs: performance.now() - started,
		});
	})().catch((error: unknown) => {
		backgroundInitialization = null;
		observability.lifecycle({
			operationId: "INITIALIZE",
			status: "FAILED",
			error,
			durationMs: performance.now() - started,
		});
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
	void startBackgroundRuntime().catch(() => undefined);
}

chrome.alarms.onAlarm.addListener((alarm) => {
	if (alarm.name === reconnectAlarm) requestBackgroundStart();
});
chrome.runtime.onInstalled.addListener(requestBackgroundStart);
chrome.runtime.onStartup.addListener(requestBackgroundStart);
requestBackgroundStart();

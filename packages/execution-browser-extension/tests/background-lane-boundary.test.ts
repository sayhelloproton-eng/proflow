import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("Browser background is composition while runtime flows have isolated owners", async () => {
	const [
		background,
		browserLane,
		localToolLane,
		provisioningLane,
		applicationClient,
		observerRecovery,
		pageReality,
		permissionController,
		browserCommands,
		runtimeMessages,
		taskPage,
	] = await Promise.all([
		read("../extension/background.ts"),
		read("../extension/runtime/browser-session-lane.ts"),
		read("../extension/runtime/local-tool-lane.ts"),
		read("../extension/runtime/provisioning-lane.ts"),
		read("../extension/runtime/application-client.ts"),
		read("../extension/runtime/observer-recovery-controller.ts"),
		read("../extension/runtime/page-reality-controller.ts"),
		read("../extension/runtime/permission-controller.ts"),
		read("../extension/runtime/browser-command-controller.ts"),
		read("../extension/runtime/runtime-message-router.ts"),
		read("../extension/runtime/task-page-controller.ts"),
	]);

	for (const owner of [
		"createBrowserSessionLane",
		"createLocalToolLane",
		"createProvisioningLane",
		"createApplicationClient",
		"createObserverRecoveryController",
		"createPageRealityController",
		"createPermissionController",
		"createBrowserCommandController",
		"createRuntimeMessageRouter",
		"createTaskPageController",
	])
		assert.match(background, new RegExp(owner));

	for (const leaked of [
		/\/v1\/(?:local-tools|provisioning|commands)\//,
		/createCollaborationCarrierApplication/,
		/createSystemObserver/,
		/resolveRoutineCarrierPermission/,
		/resolveHumanCarrierPermission/,
		/carrierBlockerStrategies/,
		/handleActionPermission/,
		/permissionAction/,
		/MANAGED_RUNTIME_CONFIG_INVALID/,
		/\/application\/observer/,
	])
		assert.doesNotMatch(background, leaked);

	assert.match(browserLane, /\/v1\/commands\/next/);
	assert.doesNotMatch(browserLane, /\/v1\/local-tools\//);
	assert.doesNotMatch(browserLane, /\/v1\/provisioning\//);

	assert.match(localToolLane, /\/v1\/local-tools\/commands\/next/);
	assert.doesNotMatch(
		localToolLane,
		/\b(?:taskId|nodeId|workerRef|conversationLocator|carrierAttention|permission)\b/,
	);
	assert.match(provisioningLane, /\/v1\/provisioning\/commands\/next/);
	assert.doesNotMatch(
		provisioningLane,
		/\b(?:TaskObserver|SystemObserver|Collaboration|taskId|nodeId|workerRef|conversationLocator|executionRef|WAKE_GUARD)\b/,
	);

	assert.match(applicationClient, /MANAGED_RUNTIME_CONFIG_INVALID/);
	assert.match(applicationClient, /application\/\$\{surface\}/);
	assert.doesNotMatch(applicationClient, /\bbridgeFetch\b/);
	assert.doesNotMatch(applicationClient, /chrome\.tabs|ACTION_PERMISSION|createSystemObserver/);

	assert.match(observerRecovery, /createCollaborationCarrierApplication/);
	assert.match(observerRecovery, /createSystemObserver/);
	assert.match(observerRecovery, /task\.reconcileAll/);
	assert.doesNotMatch(observerRecovery, /chrome\.tabs|ACTION_PERMISSION|permissionAction/);

	assert.match(pageReality, /createBrowserOpenObservationGate/);
	assert.match(pageReality, /CONTENT_SESSION_NOT_READY/);
	assert.doesNotMatch(pageReality, /AUTO_ALLOW|KNOWN_PROFLOW_ACTION|task\.reconcileAll/);

	assert.match(permissionController, /browser\.permission\.classify/);
	assert.match(permissionController, /resolveRoutineCarrierPermission/);
	assert.doesNotMatch(permissionController, /if \(!identity \|\| !facts\.taskId\)/);
	assert.match(permissionController, /\.\.\.\(facts\.taskId \? \{ taskId: facts\.taskId \} : \{\}\)/);
	assert.doesNotMatch(permissionController, /chrome\.tabs/);

	assert.match(browserCommands, /CARRIER_ATTENTION_ACTION/);
	assert.match(browserCommands, /WAKE_GUARD/);
	assert.doesNotMatch(browserCommands, /AUTO_ALLOW|browser\.permission\.classify/);
	assert.match(runtimeMessages, /PROFLOW_CONTENT_OBSERVATION/);
	assert.match(taskPage, /\/v1\/tasks\/session/);
});

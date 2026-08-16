import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const sourceUrl = new URL("../src/index.ts", import.meta.url);

async function source(): Promise<string> {
	return readFile(sourceUrl, "utf8");
}

test("CP-HOST-03 current host transport surface has no Task authorization compatibility command", async () => {
	const text = await source();
	assert.doesNotMatch(text, /authorizeTask|authorizedByRef|TASK_AUTHORIZED/);
	assert.doesNotMatch(text, /requiredRoleRef/);
	assert.match(text, /requiredAgentPackageRef|agentPackageRef/);
});

test("CP-HOST-04 readiness stays a host/dependency projection and never becomes System Assessment truth", async () => {
	const text = await source();
	assert.match(text, /DependencyReadiness|readiness/);
	assert.doesNotMatch(
		text,
		/systemAssessment\s*:\s*|assessmentTruth|overallBusinessReady/,
	);
});

test("CP-HOST-05 restart reconstructs owner graph and contains no mutation replay journal", async () => {
	const text = await source();
	assert.match(text, /restart/);
	assert.doesNotMatch(
		text,
		/replay(?:Mutation|Command|Effect)|mutationJournal|commandJournal/i,
	);
});

test("CP-HOST-06 host exposes routing paths for Task drive projection and Model infer without owning Observer loops", async () => {
	const text = await source();
	assert.match(text, /getTaskDriveProjection/);
	assert.match(text, /infer/);
	assert.doesNotMatch(
		text,
		/setInterval\([^)]*(?:observer|assessment)|taskObserverLoop|systemObserverLoop|assessmentStore/i,
	);
});

test("CP-HOST-07 host has no universal scheduler, Browser frame registry, or direct observer business mutation path", async () => {
	const text = await source();
	for (const forbidden of [
		/universalScheduler/i,
		/eventBus.*(?:completeNode|reopenNode|approve)/i,
		/frameRegistry/i,
		/frameRoleHandshake/i,
		/persistentTab/i,
		/systemObserver.*(?:completeNode|reopenNode|authorize|approve)/i,
	]) {
		assert.doesNotMatch(text, forbidden);
	}
});

test("PRESMOKE-B3-OBS-HOST-01 platform-host exposes Observer transport but owns no Task/System Observer lifecycle", async () => {
	const text = await source();
	assert.match(text, /\/application\/observer/);
	assert.doesNotMatch(text, /createCollaborationCarrierApplication\(/);
	assert.doesNotMatch(text, /createTaskObserver\(/);
	assert.doesNotMatch(text, /createSystemObserver\(/);
	assert.doesNotMatch(
		text,
		/recoverTaskObserver|SYSTEM_OBSERVER_STARTUP_ASSESSMENT|TASK_OBSERVER_STARTUP_RECOVERY/,
	);
	assert.doesNotMatch(text, /setInterval\([^)]*(?:observer|assessment)/i);
});

test("PRESMOKE-B3-OBS-ASYNC-01 synchronous executeCapability completion does not manufacture a new Worker Turn", async () => {
	const text = await source();
	const executeBranch = text.slice(
		text.indexOf('if (operationId === "executeCapability") {'),
		text.indexOf('if (operationId === "getExecution" ||'),
	);
	assert.match(executeBranch, /execution\.invoke/);
	assert.doesNotMatch(executeBranch, /triggerTaskObserver/);
	assert.match(
		text,
		/Only a future explicit async-completion signal may emit EXECUTION_RESULT_READY/,
	);
});

test("PRESMOKE-B3-SYSOBS-OWNER-01 all eight owner views are bounded projections without borrowing another owner's readiness", async () => {
	const text = await source();
	assert.match(text, /owner aggregate projection unavailable/);
	assert.match(text, /no substitute owner readiness is inferred/);
	for (const view of [
		'"task"',
		'"worker"',
		'"collaboration"',
		'"execution"',
		'"carrier"',
		'"model"',
		'"deployment"',
		'"artifact"',
	])
		assert.match(text, new RegExp(`view === ${view}`));
	assert.match(text, /listExecutionObserverSignals/);
	assert.match(
		text,
		/unknown drilldown topic is not defaulted to execution or another owner/,
	);
	assert.doesNotMatch(
		text,
		/view === "carrier"[\s\S]{0,160}model\.readiness\(\)/,
	);
	assert.doesNotMatch(
		text,
		/view === "artifact"[\s\S]{0,160}model\.readiness\(\)/,
	);
});

test("R2-P1-15-SYSOBS-01 carrier/deployment/artifact views read their own owner, never a borrowed signal", async () => {
	const text = await source();
	// Carrier view comes from the Execution-owned Browser Carrier summary, not
	// from Execution recovery observer signals.
	const carrierBranch = text.slice(
		text.indexOf('view === "carrier"'),
		text.indexOf('view === "deployment"'),
	);
	assert.match(carrierBranch, /getCarrierSummary/);
	assert.doesNotMatch(carrierBranch, /RECOVERY_RESUME/);

	// Deployment view projects the Deployment owner's persisted summary; it must
	// never synthesize allReady from Execution/Model/Agent/Task readiness.
	const deploymentBranch = text.slice(
		text.indexOf('view === "deployment"'),
		text.indexOf('view === "artifact"'),
	);
	assert.match(deploymentBranch, /readDeploymentOwnerSummary/);
	assert.match(text, /deployment["',\s]+observer-summary\.json/);
	assert.match(text, /record\.scope !== "PLATFORM"/);
	assert.match(text, /record\.freshUntil/);
	assert.match(text, /Date\.parse\(record\.freshUntil\) <= Date\.now\(\)/);
	assert.doesNotMatch(text, /deployment["',\s]+state\.json/);
	assert.doesNotMatch(deploymentBranch, /allReady/);
	assert.doesNotMatch(deploymentBranch, /execution\.readiness\(\)/);
	assert.doesNotMatch(deploymentBranch, /model\.readiness\(\)/);

	// Artifact view projects the Execution artifact/evidence summary, not a
	// count of UNKNOWN_REALITY observer signals.
	const artifactStart = text.indexOf('view === "artifact"');
	const artifactEnd = text.indexOf(
		"owner aggregate projection unavailable",
		artifactStart,
	);
	const artifactBranch = text.slice(artifactStart, artifactEnd);
	assert.match(artifactBranch, /getArtifactSummary/);
	assert.doesNotMatch(artifactBranch, /UNKNOWN_REALITY/);
});

test("PRESMOKE-B3-OBS-TRANSPORT-01 host exposes authenticated Observer owner/model transport without making it a scheduler", async () => {
	const text = await source();
	assert.match(text, /\/application\/observer/);
	assert.match(text, /task\.projection/);
	assert.match(text, /task\.diagnostic/);
	assert.match(text, /system\.view/);
	assert.match(text, /system\.reason/);
	assert.match(text, /extension:task-observer/);
	assert.match(text, /extension:system-observer/);
	assert.doesNotMatch(text, /setInterval\([^)]*(?:observer|assessment)/i);
});

test("PRESMOKE-B3-CARRIER-TRANSPORT-01 Collaboration Carrier transport cannot proxy arbitrary Execution capabilities or caller identity", async () => {
	const text = await source();
	assert.match(text, /COLLABORATION_CARRIER_CAPABILITY_DENIED/);
	assert.match(text, /request\.capability !== "collaboration\.deliver"/);
	assert.match(text, /callerRef:\s*"extension:collaboration-carrier"/);
	assert.match(text, /capability:\s*"collaboration\.deliver"/);
});

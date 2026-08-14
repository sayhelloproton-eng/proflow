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
	assert.doesNotMatch(text, /systemAssessment\s*:\s*|assessmentTruth|overallBusinessReady/);
});

test("CP-HOST-05 restart reconstructs owner graph and contains no mutation replay journal", async () => {
	const text = await source();
	assert.match(text, /restart/);
	assert.doesNotMatch(text, /replay(?:Mutation|Command|Effect)|mutationJournal|commandJournal/i);
});

test("CP-HOST-06 host exposes routing paths for Task drive projection and Model infer without owning Observer loops", async () => {
	const text = await source();
	assert.match(text, /getTaskDriveProjection/);
	assert.match(text, /infer/);
	assert.doesNotMatch(text, /setInterval\([^)]*(?:observer|assessment)|taskObserverLoop|systemObserverLoop|assessmentStore/i);
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

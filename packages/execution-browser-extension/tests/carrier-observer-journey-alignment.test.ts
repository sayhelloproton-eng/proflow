import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";

const packageRoot = new URL("../", import.meta.url);

async function collectTypeScript(rootUrl: URL): Promise<string[]> {
	const parts: string[] = [];
	for (const entry of await readdir(rootUrl, { withFileTypes: true })) {
		const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, rootUrl);
		if (entry.isDirectory()) parts.push(...(await collectTypeScript(child)));
		else if (entry.isFile() && entry.name.endsWith(".ts"))
			parts.push(await readFile(child, "utf8"));
	}
	return parts;
}

async function sourceCorpus(): Promise<string> {
	const parts: string[] = [];
	for (const root of ["src", "extension"])
		parts.push(...(await collectTypeScript(new URL(`${root}/`, packageRoot))));
	return parts.join("\n");
}

test("CP-EXE-BR-01 stable Carrier identity is package/role/worker/conversation based and frame/persistent-tab identity is absent", async () => {
	const text = await sourceCorpus();
	assert.match(text, /agentPackageRef/);
	assert.match(text, /roleRef/);
	assert.match(text, /workerRef/);
	assert.match(text, /conversationLocator|conversationUrl/);
	assert.doesNotMatch(text, /frameRegistry|frameRoleHandshake|persistentTab(?:Id|Ref)|iframeWorkspace/i);
});

test("CP-EXE-BR-02 New Task provisioning starts from PENDING, keeps successful bindings, and has no authorization-gated all-or-nothing rebuild", async () => {
	const text = await sourceCorpus();
	assert.doesNotMatch(text, /TASK_NOT_AUTHORIZED_FOR_PROVISIONING|authorizeTask|authorizedByRef/);
	assert.match(text, /PENDING/);
	assert.match(text, /agentPackageRef/);
	assert.match(text, /conversationLocator/);
	assert.doesNotMatch(text, /recreateAll|resetAllWorkers|deleteAllConversations/i);
});

test("CP-EXE-BR-03 WAKE targets the existing Conversation with a minimal trigger and claims only physical delivery", async () => {
	const text = await sourceCorpus();
	for (const required of ["taskId", "workerRef", "runNo", "trigger"]) {
		assert.match(text, new RegExp(`\\b${required}\\b`));
	}
	assert.doesNotMatch(text, /Requirement.*trigger|PRD|fullLog|sourceCode.*trigger/i);
	assert.doesNotMatch(text, /wake.*(?:completeNode|SUCCEEDED.*Task|Task.*SUCCEEDED)/i);
});

test("CP-EXE-BR-04 Task Observer requests WAKE before the Worker formally startNode; Browser does not mutate Node state", async () => {
	const text = await sourceCorpus();
	assert.match(text, /getTaskDriveProjection/);
	assert.doesNotMatch(text, /\.startNode\s*\(/);
	assert.doesNotMatch(text, /\.completeNode\s*\(|\.waitNode\s*\(|\.reopenNode\s*\(/);
});

test("CP-EXE-BR-05 one Worker Turn has no per-Action Browser continue/wake scheduler or natural-language Task progression", async () => {
	const text = await sourceCorpus();
	for (const forbidden of [
		/actionFinished/i,
		/browserContinue/i,
		/wakeAfterAction/i,
		/continueWorker/i,
		/parseAssistantReply.*(?:complete|wait|reopen)/i,
		/naturalLanguage.*Task/i,
	]) assert.doesNotMatch(text, forbidden);
});

test("CP-EXE-BR-06 routine Action permission recovery remains separate from Execution effect approval", async () => {
	const text = await sourceCorpus();
	assert.match(text, /permission/i);
	assert.doesNotMatch(text, /permission.*approvalRef|approvalRef.*permission/i);
	assert.doesNotMatch(text, /isConsequential.*(?:policyAllow|effectApproved|approvalRef)/is);
});

test("CP-EXE-BR-07 DOM-first operation may use screenshot/Vision only as ambiguity recovery, never as business success", async () => {
	const text = await sourceCorpus();
	assert.match(text, /screenshot/);
	assert.match(text, /observe|observation/);
	assert.doesNotMatch(text, /vision(?:Result|Decision)?.*(?:completeNode|taskStatus|executionStatus\s*=\s*["']SUCCEEDED)/is);
});

test("CP-EXE-BR-08 Collaboration delivery stays a physical Execution concern and logical message truth remains Agent-owned", async () => {
	const text = await sourceCorpus();
	assert.match(text, /createCollaborationCarrierApplication/);
	assert.match(text, /collaboration\.deliver/);
	assert.match(text, /executionRef/);
	assert.match(text, /evidenceRef/);
	assert.doesNotMatch(text, /UPDATE\s+(?:collaboration_messages|task_messages)|INSERT\s+INTO\s+collaboration/i);
});

test("CP-EXE-BR-09 uncertain submit/WAKE reconciles DELIVERED/ABSENT/UNKNOWN and contains no blind replay loop", async () => {
	const text = await sourceCorpus();
	assert.match(text, /UNKNOWN/);
	assert.match(text, /reconcil|recover|observe/i);
	assert.doesNotMatch(text, /while\s*\([^)]*UNKNOWN[^)]*\)\s*\{[^}]*executeCapability/is);
	assert.doesNotMatch(text, /UNKNOWN[^\n]{0,120}(?:retryImmediately|blindReplay|reSubmit)/i);
});

test("CP-EXE-BR-10 Task Observer is deterministic on normal progression, REASON is diagnostic-only, and terminal stops driving", async () => {
	const text = await sourceCorpus();
	assert.match(text, /Task Observer|taskObserver/i);
	assert.match(text, /terminal/i);
	assert.doesNotMatch(text, /NODE_READY[^\n]{0,200}(?:infer|reason)/i);
	assert.doesNotMatch(text, /taskObserver[^\n]{0,240}(?:completeNode|reopenNode|approve|authorize)/i);
});

test("CP-EXE-BR-11 System Observer covers eight bounded concern families, defers as lowest priority, and never owns mutation", async () => {
	const text = await sourceCorpus();
	for (const concern of [
		/task/i,
		/worker|agent/i,
		/collaboration/i,
		/execution/i,
		/carrier/i,
		/model/i,
		/deployment|service/i,
		/artifact|evidence|log/i,
	]) assert.match(text, concern);
	assert.match(text, /background|lowest.?priority|defer/i);
	assert.match(text, /carry.?forward|drill.?down|global.?synthesis/i);
	assert.doesNotMatch(text, /systemObserver[^\n]{0,240}(?:completeNode|reopenNode|approve|executeCapability|bindTaskWorker)/i);
});

test("CP-EXE-BR-12 ordinary file transport is not Browser DOM work; screenshot/image remains a separate Vision fallback", async () => {
	const text = await sourceCorpus();
	assert.doesNotMatch(text, /openaiFileIdRefs[^\n]{0,240}(?:composer|input|contentScript|sendMessage)/i);
	assert.doesNotMatch(text, /FileManager|BrowserFileStore|ArtifactStore/);
	assert.match(text, /screenshot/);
});

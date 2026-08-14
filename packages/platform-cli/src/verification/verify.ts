import { createHash } from "node:crypto";

import type { ModuleOperationResult } from "@tomflow/proflow-module-contract";

import type { ResolvedModule, VerificationRecord } from "../contracts.ts";
import { dispatchLifecycle } from "../lifecycle/index.ts";
import type { ModuleCatalog } from "../modules.ts";
import type { WorkspacePaths } from "../paths.ts";
import { appendVerification, loadConfig } from "../persistence/index.ts";

export interface VerifyResult {
	moduleRef: string;
	record: VerificationRecord;
	result: ModuleOperationResult;
	observedEffects: string[];
}

/**
 * Derives a stable verificationRef from the record's own identity fields. It is
 * deterministic (no randomness) yet unique per verification event, because the
 * recorded `verifiedAt` timestamp is part of the canonical input.
 */
export function verificationRefOf(
	record: Omit<VerificationRecord, "verificationRef">,
): string {
	const canonical = JSON.stringify([
		record.moduleRef,
		record.moduleVersion,
		record.resourceIdentity ?? null,
		record.resourceVersion ?? null,
		record.result,
		record.verifiedAt,
	]);
	const digest = createHash("sha256").update(canonical).digest("hex");
	return `verify-${record.moduleRef}-${digest.slice(0, 16)}`;
}

/**
 * Fingerprints the identity-defining config of an external resource. Key order
 * is normalized so the fingerprint is stable regardless of insertion order.
 */
export function configFingerprint(values: Record<string, string>): string {
	const canonical = Object.entries(values)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, value]) => `${key}=${value}`)
		.join("\n");
	const digest = createHash("sha256").update(canonical).digest("hex");
	return `fp-${digest.slice(0, 16)}`;
}

// A verification record is a binary verdict: only an explicit SUCCEEDED maps to
// PASS. BLOCKED / ACTION_REQUIRED / FAILED are all recorded as FAIL so a pending
// human action or blocked dependency can never masquerade as a passing verify.
function verdictOf(
	status: ModuleOperationResult["status"],
): VerificationRecord["result"] {
	return status === "SUCCEEDED" ? "PASS" : "FAIL";
}

function summaryOf(result: ModuleOperationResult): string {
	if (result.status === "SUCCEEDED") {
		const checks = result.checks ?? [];
		if (checks.length === 0) return "verify succeeded";
		const passed = checks.filter((check) => check.status === "PASS").length;
		return `verify succeeded (${passed}/${checks.length} checks passed)`;
	}
	if (
		result.status === "ACTION_REQUIRED" &&
		result.actionRequired !== undefined
	) {
		return `action required: ${result.actionRequired.action} — ${result.actionRequired.description}`;
	}
	if (result.error !== undefined) {
		return `${result.error.code}: ${result.error.message}`;
	}
	return `verify ${result.status.toLowerCase()}`;
}

function evidenceRefsOf(result: ModuleOperationResult): string[] {
	return (result.checks ?? []).map(
		(check) => `check:${check.id}:${check.status}`,
	);
}

/**
 * Verifies a single module by dispatching its public `verify` primitive through
 * the lifecycle boundary, then appending a Version Verification Record. The
 * verdict always comes from the live adapter result, never from persisted
 * history. Records are appended, never overwritten.
 */
export async function verifyModule(
	catalog: ModuleCatalog,
	module: ResolvedModule,
	paths: WorkspacePaths,
): Promise<VerifyResult> {
	const dispatched = await dispatchLifecycle(catalog, module, "verify");
	const result = dispatched.result;

	let resourceIdentity: string | undefined;
	let resourceVersion: string | undefined;
	if (module.kind === "external-resource") {
		const config = await loadConfig(paths, module.moduleRef);
		resourceIdentity = configFingerprint(config?.publicValues ?? {});
		resourceVersion = result.resourceVersion;
	}

	const base: Omit<VerificationRecord, "verificationRef"> = {
		moduleRef: module.moduleRef,
		moduleVersion: module.moduleVersion,
		result: verdictOf(result.status),
		summary: summaryOf(result),
		evidenceRefs: evidenceRefsOf(result),
		verifiedAt: new Date().toISOString(),
		...(resourceIdentity !== undefined ? { resourceIdentity } : {}),
		...(resourceVersion !== undefined ? { resourceVersion } : {}),
	};
	const record: VerificationRecord = {
		...base,
		verificationRef: verificationRefOf(base),
	};

	await appendVerification(paths, record);
	return {
		moduleRef: module.moduleRef,
		record,
		result,
		observedEffects: dispatched.observedEffects,
	};
}

/**
 * Verifies every module that declares the `verify` primitive; modules without
 * it are skipped (the descriptor is the truth for what is verifiable).
 */
export async function verifyModules(
	catalog: ModuleCatalog,
	modules: readonly ResolvedModule[],
	paths: WorkspacePaths,
): Promise<VerifyResult[]> {
	const results: VerifyResult[] = [];
	for (const module of modules) {
		if (!module.lifecycle.includes("verify")) continue;
		results.push(await verifyModule(catalog, module, paths));
	}
	return results;
}

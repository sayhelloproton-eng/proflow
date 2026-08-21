import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { atomicWrite } from "../paths.ts";

const policyFileName = "pnpm-workspace.yaml";
const ownershipFile = (root: string) =>
	join(root, ".proflow", "deployment", "pnpm-policy-ownership.json");

async function text(root: string): Promise<string | undefined> {
	try {
		return await readFile(join(root, policyFileName), "utf8");
	} catch {
		return undefined;
	}
}

export interface PnpmPolicySnapshot {
	keyPresent: boolean;
	values: string[];
}

export async function observeMinimumReleaseAgeExclude(
	root: string,
): Promise<PnpmPolicySnapshot> {
	const source = await text(root);
	if (!source) return { keyPresent: false, values: [] };
	const lines = source.split(/\r?\n/);
	const start = lines.findIndex((line) =>
		/^minimumReleaseAgeExclude:\s*$/.test(line),
	);
	if (start < 0) return { keyPresent: false, values: [] };
	const values: string[] = [];
	for (let index = start + 1; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		if (/^\S/.test(line) && line.trim() !== "") break;
		const match = line.match(/^\s+-\s+['"]?([^'"]+)['"]?\s*$/);
		if (match?.[1]) values.push(match[1]);
	}
	return { keyPresent: true, values };
}

export async function recordPnpmPolicyOwnership(
	root: string,
	before: PnpmPolicySnapshot,
): Promise<void> {
	const after = await observeMinimumReleaseAgeExclude(root);
	const newlyIntroduced = after.values.filter(
		(value) => !before.values.includes(value),
	);
	const previous = await readOwnership(root);
	const introducedKey =
		previous.introducedKey || (!before.keyPresent && after.keyPresent);
	if (newlyIntroduced.length === 0 && !introducedKey) return;
	const introduced = [
		...new Set([...previous.introduced, ...newlyIntroduced]),
	].sort();
	await mkdir(join(root, ".proflow", "deployment"), { recursive: true });
	await atomicWrite(
		ownershipFile(root),
		`${JSON.stringify({ contract: "proflow.pnpm-policy-ownership.v1", introduced, introducedKey }, null, 2)}\n`,
	);
}

async function readOwnership(
	root: string,
): Promise<{ introduced: string[]; introducedKey: boolean }> {
	try {
		const parsed: unknown = JSON.parse(
			await readFile(ownershipFile(root), "utf8"),
		);
		const introduced =
			typeof parsed === "object" &&
			parsed !== null &&
			Array.isArray(Reflect.get(parsed, "introduced"))
				? Reflect.get(parsed, "introduced").filter(
						(value: unknown): value is string => typeof value === "string",
					)
				: [];
		return {
			introduced,
			introducedKey:
				typeof parsed === "object" &&
				parsed !== null &&
				Reflect.get(parsed, "introducedKey") === true,
		};
	} catch {
		return { introduced: [], introducedKey: false };
	}
}

export async function cleanOwnedPnpmPolicy(root: string): Promise<string[]> {
	const ownership = await readOwnership(root);
	const introduced = ownership.introduced;
	if (introduced.length === 0 && !ownership.introducedKey) return [];
	const source = await text(root);
	if (!source) return [];
	const owned = new Set(introduced);
	const lines = source.split(/\r?\n/);
	const next = lines.filter((line) => {
		const match = line.match(/^\s+-\s+['"]?([^'"]+)['"]?\s*$/);
		return !match?.[1] || !owned.has(match[1]);
	});
	if (ownership.introducedKey) {
		const keyIndex = next.findIndex((line) =>
			/^minimumReleaseAgeExclude:\s*$/.test(line),
		);
		if (keyIndex >= 0) {
			let hasValues = false;
			for (let index = keyIndex + 1; index < next.length; index += 1) {
				const line = next[index] ?? "";
				if (/^\S/.test(line) && line.trim() !== "") break;
				if (/^\s+-\s+/.test(line)) hasValues = true;
			}
			if (!hasValues) next.splice(keyIndex, 1);
		}
	}
	await atomicWrite(join(root, policyFileName), next.join("\n"));
	return introduced;
}

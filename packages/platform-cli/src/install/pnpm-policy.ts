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

export async function observeMinimumReleaseAgeExclude(
	root: string,
): Promise<string[]> {
	const source = await text(root);
	if (!source) return [];
	const lines = source.split(/\r?\n/);
	const start = lines.findIndex((line) =>
		/^minimumReleaseAgeExclude:\s*$/.test(line),
	);
	if (start < 0) return [];
	const values: string[] = [];
	for (let index = start + 1; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		if (/^\S/.test(line) && line.trim() !== "") break;
		const match = line.match(/^\s+-\s+['"]?([^'"]+)['"]?\s*$/);
		if (match?.[1]) values.push(match[1]);
	}
	return values;
}

export async function recordPnpmPolicyOwnership(
	root: string,
	before: readonly string[],
): Promise<void> {
	const after = await observeMinimumReleaseAgeExclude(root);
	const newlyIntroduced = after.filter((value) => !before.includes(value));
	if (newlyIntroduced.length === 0) return;
	const introduced = [
		...new Set([...(await readOwnedValues(root)), ...newlyIntroduced]),
	].sort();
	await mkdir(join(root, ".proflow", "deployment"), { recursive: true });
	await atomicWrite(
		ownershipFile(root),
		`${JSON.stringify({ contract: "proflow.pnpm-policy-ownership.v1", introduced }, null, 2)}\n`,
	);
}

async function readOwnedValues(root: string): Promise<string[]> {
	try {
		const parsed: unknown = JSON.parse(
			await readFile(ownershipFile(root), "utf8"),
		);
		return typeof parsed === "object" &&
			parsed !== null &&
			Array.isArray(Reflect.get(parsed, "introduced"))
			? Reflect.get(parsed, "introduced").filter(
					(value: unknown): value is string => typeof value === "string",
				)
			: [];
	} catch {
		return [];
	}
}

export async function cleanOwnedPnpmPolicy(root: string): Promise<string[]> {
	const introduced = await readOwnedValues(root);
	if (introduced.length === 0) return [];
	const source = await text(root);
	if (!source) return [];
	const owned = new Set(introduced);
	const lines = source.split(/\r?\n/);
	const next = lines.filter((line) => {
		const match = line.match(/^\s+-\s+['"]?([^'"]+)['"]?\s*$/);
		return !match?.[1] || !owned.has(match[1]);
	});
	await atomicWrite(join(root, policyFileName), next.join("\n"));
	return introduced;
}

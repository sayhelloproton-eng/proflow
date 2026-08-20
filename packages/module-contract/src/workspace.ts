import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { z } from "zod";
import type { ModuleCommandContext } from "./index.ts";

const safeModuleRef = z
	.string()
	.min(1)
	.regex(/^[a-z][a-z0-9-]*$/);
export const moduleSharedFactsSchema = z.strictObject({
	contract: z.literal("proflow.module-shared-facts.v1"),
	moduleRef: safeModuleRef,
	updatedAt: z.iso.datetime(),
	facts: z.record(z.string(), z.unknown()),
});
export type ModuleSharedFacts = z.infer<typeof moduleSharedFactsSchema>;

export function moduleWorkspaceStateDirectory(
	context: ModuleCommandContext,
	moduleRef: string,
): string {
	return join(
		resolve(context.workspaceRoot),
		".proflow",
		"runtime",
		"modules",
		safeModuleRef.parse(moduleRef),
	);
}

export function moduleSharedFactsPath(
	context: ModuleCommandContext,
	moduleRef: string,
): string {
	return join(
		moduleWorkspaceStateDirectory(context, moduleRef),
		"shared-facts.json",
	);
}

export async function readModuleSharedFacts(
	context: ModuleCommandContext,
	moduleRef: string,
): Promise<Record<string, unknown> | undefined> {
	try {
		const parsed = moduleSharedFactsSchema.parse(
			JSON.parse(
				await readFile(moduleSharedFactsPath(context, moduleRef), "utf8"),
			),
		);
		return parsed.facts;
	} catch {
		return undefined;
	}
}

export async function writeModuleSharedFacts(
	context: ModuleCommandContext,
	moduleRef: string,
	facts: Record<string, unknown>,
): Promise<ModuleSharedFacts> {
	const directory = moduleWorkspaceStateDirectory(context, moduleRef);
	await mkdir(directory, { recursive: true, mode: 0o700 });
	const target = moduleSharedFactsPath(context, moduleRef);
	const temporary = `${target}.${process.pid}.tmp`;
	const record = moduleSharedFactsSchema.parse({
		contract: "proflow.module-shared-facts.v1",
		moduleRef,
		updatedAt: new Date().toISOString(),
		facts,
	});
	await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
	await rename(temporary, target);
	return record;
}

export function deterministicLoopbackPort(
	context: ModuleCommandContext,
	moduleRef: string,
	slot = "default",
): number {
	const digest = createHash("sha256")
		.update(
			`${resolve(context.workspaceRoot)}\0${safeModuleRef.parse(moduleRef)}\0${slot}`,
		)
		.digest();
	return 40_000 + (digest.readUInt16BE(0) % 20_000);
}

export async function ensureModuleSecretFile(
	context: ModuleCommandContext,
	moduleRef: string,
	name: string,
): Promise<string> {
	if (!/^[a-z][a-z0-9-]*$/.test(name))
		throw new TypeError("invalid secret name");
	const directory = join(
		moduleWorkspaceStateDirectory(context, moduleRef),
		"secrets",
	);
	await mkdir(directory, { recursive: true, mode: 0o700 });
	const path = join(directory, `${name}.token`);
	try {
		const existing = (await readFile(path, "utf8")).trim();
		if (existing.length >= 32) {
			await chmod(path, 0o600);
			return path;
		}
	} catch {
		// Materialize below.
	}
	await writeFile(path, `${randomBytes(32).toString("base64url")}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
	return path;
}

import { randomUUID } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";

import { PlatformError } from "../errors.ts";
import { atomicWrite } from "../paths.ts";

export interface WorkspaceMetadata {
	contract: "proflow.workspace.v1";
	workspaceInstanceId: string;
	workspaceRoot: string;
	createdAt: string;
}

export async function ensureWorkspaceMetadata(
	workspaceRoot: string,
): Promise<WorkspaceMetadata> {
	const canonicalRoot = await realpath(workspaceRoot);
	const path = join(canonicalRoot, ".proflow", "workspace.json");
	try {
		const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			Array.isArray(parsed) ||
			Reflect.get(parsed, "contract") !== "proflow.workspace.v1" ||
			typeof Reflect.get(parsed, "workspaceInstanceId") !== "string" ||
			Reflect.get(parsed, "workspaceRoot") !== canonicalRoot ||
			typeof Reflect.get(parsed, "createdAt") !== "string"
		) {
			throw new PlatformError(
				"WORKSPACE_INSTANCE_INVALID",
				"existing .proflow/workspace.json does not match this Workspace",
			);
		}
		return parsed as WorkspaceMetadata;
	} catch (error) {
		if (error instanceof PlatformError) throw error;
		if (
			typeof error !== "object" ||
			error === null ||
			Reflect.get(error, "code") !== "ENOENT"
		) {
			throw new PlatformError(
				"WORKSPACE_INSTANCE_INVALID",
				`cannot read Workspace metadata: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	const metadata: WorkspaceMetadata = {
		contract: "proflow.workspace.v1",
		workspaceInstanceId: randomUUID(),
		workspaceRoot: canonicalRoot,
		createdAt: new Date().toISOString(),
	};
	await atomicWrite(path, `${JSON.stringify(metadata, null, 2)}\n`);
	return metadata;
}

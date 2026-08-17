import { rm } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import type { DeploymentEffect } from "@tomflow/proflow-module-contract";

import { PlatformError } from "../errors.ts";

/**
 * Removes only package-declared ephemeral filesystem effects under the
 * Workspace-owned `.proflow` state tree. Persistent and explicit-purge effects
 * are never deleted by ordinary uninstall. Paths outside `.proflow` are left to
 * the package-owned uninstall adapter so a descriptor can never turn the
 * platform package manager into an arbitrary recursive-delete primitive.
 */
export async function cleanupRemovableFilesystemEffects(input: {
	workspaceRoot: string;
	effects: readonly DeploymentEffect[];
}): Promise<string[]> {
	const workspaceRoot = resolve(input.workspaceRoot);
	const proflowRoot = resolve(workspaceRoot, ".proflow");
	const removed: string[] = [];

	for (const effect of input.effects) {
		if (
			effect.kind !== "filesystem" ||
			effect.retention !== "remove" ||
			effect.path === undefined
		) {
			continue;
		}
		if (isAbsolute(effect.path)) {
			throw new PlatformError(
				"UNINSTALL_FAILED",
				`removable filesystem effect must use a Workspace-relative .proflow path: ${effect.path}`,
			);
		}
		const target = resolve(workspaceRoot, effect.path);
		const withinProflow = relative(proflowRoot, target);
		if (
			target === proflowRoot ||
			withinProflow === "" ||
			withinProflow === ".." ||
			withinProflow.startsWith(
				`..${process.platform === "win32" ? "\\" : "/"}`,
			) ||
			isAbsolute(withinProflow)
		) {
			throw new PlatformError(
				"UNINSTALL_FAILED",
				`refusing unsafe removable filesystem effect outside a .proflow child path: ${effect.path}`,
			);
		}
		await rm(target, { recursive: true, force: true });
		removed.push(effect.path);
	}

	return removed;
}

import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { descriptor } from "./descriptor.ts";

const success = (checks?: unknown[]) => ({
	contract: "deployment.result.v1" as const,
	ok: true,
	status: "SUCCEEDED" as const,
	moduleRef: descriptor.moduleRef,
	moduleVersion: descriptor.moduleVersion,
	...(checks === undefined ? {} : { checks }),
});

const actionRequired = (description: string, checks?: unknown[]) => ({
	contract: "deployment.result.v1" as const,
	ok: false,
	status: "ACTION_REQUIRED" as const,
	moduleRef: descriptor.moduleRef,
	moduleVersion: descriptor.moduleVersion,
	actionRequired: { action: "configure-execution-local", description },
	...(checks === undefined ? {} : { checks }),
});

async function writableAncestor(path: string): Promise<string | undefined> {
	let current = resolve(path);
	for (;;) {
		try {
			const info = await stat(current);
			if (!info.isDirectory()) return undefined;
			await access(current, constants.R_OK | constants.W_OK);
			return current;
		} catch {
			const parent = dirname(current);
			if (parent === current) return undefined;
			current = parent;
		}
	}
}

async function inspect(config: Record<string, string>): Promise<{
	ok: boolean;
	message: string;
}> {
	const projectRoot = config.projectRoot;
	const artifactRoot = config.artifactRoot;
	if (!projectRoot || !artifactRoot) {
		return { ok: false, message: "projectRoot and artifactRoot are required" };
	}
	try {
		const project = await stat(resolve(projectRoot));
		if (!project.isDirectory()) {
			return { ok: false, message: "projectRoot is not a directory" };
		}
		await access(resolve(projectRoot), constants.R_OK | constants.W_OK);
		if ((await writableAncestor(artifactRoot)) === undefined) {
			return {
				ok: false,
				message: "artifactRoot has no writable filesystem ancestor",
			};
		}
		return {
			ok: true,
			message:
				"project boundary and artifact output location are observable and writable",
		};
	} catch (error) {
		return {
			ok: false,
			message:
				error instanceof Error
					? error.message
					: "execution-local filesystem reality is unavailable",
		};
	}
}

export function createBehaviorAdapter(config: Record<string, string> = {}) {
	return {
		describe: () => ({ result: success(), observedEffects: [] }),
		preflight: async () => {
			const reality = await inspect(config);
			return {
				result: reality.ok ? success() : actionRequired(reality.message),
				observedEffects: [],
			};
		},
		verify: async () => {
			const reality = await inspect(config);
			const check = {
				id: "local-real-gate",
				status: reality.ok ? ("PASS" as const) : ("FAIL" as const),
				message: reality.message,
			};
			return {
				result: reality.ok
					? success([check])
					: actionRequired(reality.message, [check]),
				observedEffects: [],
			};
		},
		doctor: async () => {
			const reality = await inspect(config);
			return {
				result: reality.ok ? success() : actionRequired(reality.message),
				observedEffects: [],
			};
		},
	};
}

export const behaviorAdapter = createBehaviorAdapter();

export function createProductionBinding(input: {
	config: Record<string, string>;
}): { behaviorAdapter: Record<string, unknown> } {
	return { behaviorAdapter: createBehaviorAdapter(input.config) };
}

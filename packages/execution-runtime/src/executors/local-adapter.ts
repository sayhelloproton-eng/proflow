import {
	type LocalCapabilityId,
	localCapabilityIds,
} from "@tomflow/proflow-execution-contracts";
import {
	createLocalExecutor,
	type LocalExecutorOptions,
	type LocalPrecondition,
} from "@tomflow/proflow-execution-local";
import type {
	ExecutionExecutorPort,
	ExecutorPrecondition,
} from "../executor-port.ts";

const localCapabilitySet = new Set<string>(localCapabilityIds);

/**
 * Adapts the concrete `execution-local` executor library to the owner-neutral
 * Runtime Executor Port. `execution-local` keeps its own concrete public
 * types; this boundary is the only place that translates them.
 */
function toLocalPrecondition(
	precondition: ExecutorPrecondition,
): LocalPrecondition {
	switch (precondition.kind) {
		case "file.write":
		case "patch.apply":
		case "git.commit":
		case "install-dependency":
		case "process.start":
		case "process.stop":
			return precondition;
		case "opaque": {
			if (!localCapabilitySet.has(precondition.capability))
				throw new TypeError(
					"a non-local capability precondition reached the local adapter",
				);
			return {
				kind: "opaque",
				capability: precondition.capability as LocalCapabilityId,
			};
		}
		case "browser":
			throw new TypeError(
				"a browser precondition cannot be routed to the local executor",
			);
	}
}

export function adaptLocalExecutor(
	executor: Awaited<ReturnType<typeof createLocalExecutor>>,
): ExecutionExecutorPort {
	return {
		bindPatchArtifactResolver(resolver) {
			executor.bindPatchArtifactResolver(resolver);
		},
		async execute(invocation) {
			const { onEffectStarted, ...rest } = invocation;
			return executor.execute({
				...rest,
				...(onEffectStarted
					? {
							onEffectStarted: (precondition: LocalPrecondition) =>
								onEffectStarted(precondition),
						}
					: {}),
			});
		},
		async reconcile(request, precondition) {
			return executor.reconcile(request, toLocalPrecondition(precondition));
		},
		observePrecondition: executor.observePrecondition,
		readArtifact: executor.readArtifact,
	};
}

export async function createLocalExecutorPort(
	options: LocalExecutorOptions,
): Promise<ExecutionExecutorPort> {
	return adaptLocalExecutor(await createLocalExecutor(options));
}

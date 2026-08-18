import { accessSync, constants } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";

import type { ModuleRequirement } from "@tomflow/proflow-module-contract";

import type { ResolvedModule } from "../contracts.ts";
import { versionSatisfies } from "../modules.ts";

export type ProbeStatus = "PASS" | "FAIL" | "ACTION_REQUIRED";

export interface RequirementProbe {
	moduleRef: string;
	requirement: ModuleRequirement;
	status: ProbeStatus;
	message: string;
}

type RuntimeRequirement = Extract<ModuleRequirement, { kind: "runtime" }>;
type ExecutableRequirement = Extract<ModuleRequirement, { kind: "executable" }>;
type FilesystemRequirement = Extract<ModuleRequirement, { kind: "filesystem" }>;
type PortRequirement = Extract<ModuleRequirement, { kind: "port" }>;
type NetworkRequirement = Extract<ModuleRequirement, { kind: "network" }>;
type ModuleContractRequirement = Extract<
	ModuleRequirement,
	{ kind: "module-contract" }
>;

function compareRef(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

export async function probeAllRequirements(
	modules: readonly ResolvedModule[],
	humanVerifiedModuleRefs: ReadonlySet<string> = new Set(),
): Promise<RequirementProbe[]> {
	const sorted = [...modules].sort((a, b) =>
		compareRef(a.moduleRef, b.moduleRef),
	);
	const results: RequirementProbe[] = [];
	for (const module of sorted) {
		for (const requirement of module.requirements) {
			results.push(
				await probeRequirement(
					module.moduleRef,
					requirement,
					modules,
					humanVerifiedModuleRefs,
				),
			);
		}
	}
	return results;
}

export async function probeRequirement(
	moduleRef: string,
	requirement: ModuleRequirement,
	modules: readonly ResolvedModule[],
	humanVerifiedModuleRefs: ReadonlySet<string> = new Set(),
): Promise<RequirementProbe> {
	switch (requirement.kind) {
		case "runtime":
			return probeRuntime(moduleRef, requirement);
		case "executable":
			return probeExecutable(moduleRef, requirement);
		case "filesystem":
			return probeFilesystem(moduleRef, requirement);
		case "port":
			return probePort(moduleRef, requirement);
		case "network":
			return probeNetwork(moduleRef, requirement);
		case "module-contract":
			return probeModuleContract(moduleRef, requirement, modules);
		case "human":
			return humanVerifiedModuleRefs.has(moduleRef)
				? {
						moduleRef,
						requirement,
						status: "PASS",
						message: `human prerequisite verified for ${moduleRef}`,
					}
				: {
						moduleRef,
						requirement,
						status: "ACTION_REQUIRED",
						message: requirement.action,
					};
	}
}

function probeRuntime(
	moduleRef: string,
	requirement: RuntimeRequirement,
): RequirementProbe {
	if (requirement.runtime !== "node") {
		return {
			moduleRef,
			requirement,
			status: "PASS",
			message: `${requirement.runtime} runtime availability is not probed by platform-cli`,
		};
	}
	const version = process.version.startsWith("v")
		? process.version.slice(1)
		: process.version;
	const satisfied = versionSatisfies(version, requirement.versionRange);
	return satisfied
		? {
				moduleRef,
				requirement,
				status: "PASS",
				message: `node ${version} satisfies ${requirement.versionRange}`,
			}
		: {
				moduleRef,
				requirement,
				status: "FAIL",
				message: `node ${version} does not satisfy ${requirement.versionRange}`,
			};
}

function probeExecutable(
	moduleRef: string,
	requirement: ExecutableRequirement,
): RequirementProbe {
	const found = findOnPath(requirement.command);
	return found
		? {
				moduleRef,
				requirement,
				status: "PASS",
				message: `executable ${requirement.command} found on PATH`,
			}
		: {
				moduleRef,
				requirement,
				status: "FAIL",
				message: `executable ${requirement.command} not found on PATH`,
			};
}

// Bounded by construction: a synchronous scan of the finite PATH directory
// list. It spawns no subprocess, so it cannot hang.
function findOnPath(command: string): boolean {
	const path = process.env.PATH ?? "";
	const directories = path.split(":").filter((entry) => entry !== "");
	for (const directory of directories) {
		const candidate = join(directory, command);
		try {
			accessSync(candidate, constants.X_OK);
			return true;
		} catch {
			// keep searching
		}
	}
	return false;
}

function probeFilesystem(
	moduleRef: string,
	requirement: FilesystemRequirement,
): RequirementProbe {
	const mode =
		requirement.access === "read"
			? constants.R_OK
			: requirement.access === "write"
				? constants.W_OK
				: constants.R_OK | constants.W_OK;
	try {
		accessSync(requirement.path, mode);
		return {
			moduleRef,
			requirement,
			status: "PASS",
			message: `path ${requirement.path} is ${requirement.access} accessible`,
		};
	} catch {
		return {
			moduleRef,
			requirement,
			status: "FAIL",
			message: `path ${requirement.path} is not ${requirement.access} accessible`,
		};
	}
}

async function probePort(
	moduleRef: string,
	requirement: PortRequirement,
): Promise<RequirementProbe> {
	if (requirement.protocol === "udp") {
		return {
			moduleRef,
			requirement,
			status: "PASS",
			message: `udp port ${requirement.port} is not probed by platform-cli`,
		};
	}
	return new Promise<RequirementProbe>((resolve) => {
		let settled = false;
		const socket = connect({ host: "127.0.0.1", port: requirement.port });
		const finish = (result: RequirementProbe): void => {
			if (settled) return;
			settled = true;
			socket.destroy();
			resolve(result);
		};
		const timer = setTimeout(() => {
			finish({
				moduleRef,
				requirement,
				status: "FAIL",
				message: `port ${requirement.port} probe timed out`,
			});
		}, 2_000);
		socket.once("connect", () => {
			clearTimeout(timer);
			finish({
				moduleRef,
				requirement,
				status: "FAIL",
				message: `port ${requirement.port} is already in use`,
			});
		});
		socket.once("error", () => {
			clearTimeout(timer);
			finish({
				moduleRef,
				requirement,
				status: "PASS",
				message: `port ${requirement.port} is available`,
			});
		});
	});
}

async function probeNetwork(
	moduleRef: string,
	requirement: NetworkRequirement,
): Promise<RequirementProbe> {
	try {
		const response = await fetch(requirement.url, {
			method: "GET",
			signal: AbortSignal.timeout(3_000),
		});
		return {
			moduleRef,
			requirement,
			status: "PASS",
			message: `network ${requirement.url} reachable (HTTP ${response.status})`,
		};
	} catch {
		return {
			moduleRef,
			requirement,
			status: "FAIL",
			message: `network ${requirement.url} unreachable`,
		};
	}
}

function probeModuleContract(
	moduleRef: string,
	requirement: ModuleContractRequirement,
	modules: readonly ResolvedModule[],
): RequirementProbe {
	const providers = modules.filter((module) =>
		module.provides.some(
			(provide) => provide.contractRef === requirement.contractRef,
		),
	);
	const matching = providers.filter((module) =>
		module.provides.some(
			(provide) =>
				provide.contractRef === requirement.contractRef &&
				versionSatisfies(provide.version, requirement.versionRange),
		),
	);
	if (matching.length > 0) {
		const refs = matching
			.map((module) => module.moduleRef)
			.sort(compareRef)
			.join(", ");
		return {
			moduleRef,
			requirement,
			status: "PASS",
			message: `module-contract ${requirement.contractRef} satisfied by ${refs}`,
		};
	}
	if (providers.length > 0) {
		return {
			moduleRef,
			requirement,
			status: "FAIL",
			message: `module-contract ${requirement.contractRef} providers incompatible with ${requirement.versionRange}`,
		};
	}
	return {
		moduleRef,
		requirement,
		status: "FAIL",
		message: `module-contract ${requirement.contractRef} has no provider`,
	};
}

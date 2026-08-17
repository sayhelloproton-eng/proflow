import { constants } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { PlatformError } from "../errors.ts";
import { versionSatisfies } from "../modules.ts";
import {
	type NpmCommandRunner,
	resolveScopeRegistry,
	systemNpmRunner,
} from "../registry/index.ts";
import {
	findExecutable,
	readWorkspacePackageManagerSelection,
	type SupportedWorkspacePackageManager,
	systemPackageCommandRunner,
} from "./package-manager.ts";

export const PLATFORM_INSTALL_NODE_RANGE = ">=24.19.0";

export type InstallerPreflightStatus = "READY" | "ACTION_REQUIRED" | "BLOCKED";
export type InstallerFindingSeverity = "info" | "action" | "error";

export interface InstallerFinding {
	code: string;
	severity: InstallerFindingSeverity;
	message: string;
}

export interface InstallerEnvironmentPreflightResult {
	contract: "deployment.installer-preflight.v1";
	ok: boolean;
	status: InstallerPreflightStatus;
	workspaceRoot: string;
	nodeVersion: string;
	npmVersion?: string;
	packageManager?: {
		name: SupportedWorkspacePackageManager;
		declared?: string;
		version?: string;
	};
	registry?: string;
	findings: InstallerFinding[];
}

interface WorkspacePackageJson {
	packageManager?: unknown;
}

export async function preflightInstallerEnvironment(options: {
	workspaceRoot: string;
	runner?: NpmCommandRunner;
}): Promise<InstallerEnvironmentPreflightResult> {
	const runner = options.runner ?? systemNpmRunner();
	const findings: InstallerFinding[] = [];
	const nodeVersion = process.versions.node;
	if (!versionSatisfies(nodeVersion, PLATFORM_INSTALL_NODE_RANGE)) {
		findings.push({
			code: "NODE_VERSION_UNSUPPORTED",
			severity: "error",
			message: `node ${nodeVersion} does not satisfy ${PLATFORM_INSTALL_NODE_RANGE}`,
		});
	} else {
		findings.push({
			code: "NODE_VERSION_READY",
			severity: "info",
			message: `node ${nodeVersion} satisfies ${PLATFORM_INSTALL_NODE_RANGE}`,
		});
	}

	const workspace = await inspectWorkspace(options.workspaceRoot);
	findings.push(...workspace.findings);

	let npmVersion: string | undefined;
	if (!findExecutable("npm")) {
		findings.push({
			code: "NPM_UNAVAILABLE",
			severity: "error",
			message: "npm executable is not available on PATH",
		});
	} else {
		try {
			const npm = await runner.run(["--version"], options.workspaceRoot);
			npmVersion = npm.stdout.trim();
			findings.push({
				code: "NPM_READY",
				severity: "info",
				message: `npm ${npmVersion || "<unknown>"} is available`,
			});
		} catch (error) {
			findings.push(platformErrorFinding(error, "NPM_UNAVAILABLE"));
		}
	}

	const packageManager = await readWorkspacePackageManagerSelection(
		options.workspaceRoot,
	);
	let packageManagerVersion: string | undefined;
	if (packageManager === undefined) {
		findings.push({
			code: "PACKAGE_MANAGER_UNSUPPORTED",
			severity: "action",
			message: `unsupported packageManager declaration: ${workspace.packageManager ?? "<unknown>"}`,
		});
	} else if (packageManager.name === "pnpm") {
		if (!findExecutable("pnpm")) {
			findings.push({
				code: "PNPM_REQUIRED",
				severity: "action",
				message: `workspace declares ${packageManager.declared}; install/enable pnpm before applying package changes`,
			});
		} else {
			try {
				const result = (
					await systemPackageCommandRunner().run(
						"pnpm",
						["--version"],
						options.workspaceRoot,
					)
				).trim();
				packageManagerVersion = result;
				findings.push({
					code: "PNPM_READY",
					severity: "info",
					message: `pnpm ${result} is available for this workspace`,
				});
			} catch (error) {
				findings.push({
					code: "PNPM_REQUIRED",
					severity: "action",
					message: error instanceof Error ? error.message : String(error),
				});
			}
		}
	} else if (npmVersion !== undefined) {
		packageManagerVersion = npmVersion;
		findings.push({
			code: "PACKAGE_MANAGER_READY",
			severity: "info",
			message:
				packageManager.declared === undefined
					? "workspace does not declare packageManager; npm will be used for bootstrap package operations"
					: `workspace declares ${packageManager.declared}`,
		});
	}

	let registry: string | undefined;
	if (npmVersion !== undefined) {
		try {
			registry = await resolveScopeRegistry(options.workspaceRoot, runner);
			await runner.run(
				["ping", "--json", "--prefer-online", `--registry=${registry}`],
				options.workspaceRoot,
			);
			findings.push({
				code: "REGISTRY_READY",
				severity: "info",
				message: `npm registry is reachable: ${registry}`,
			});
		} catch (error) {
			findings.push(platformErrorFinding(error, "REGISTRY_UNAVAILABLE"));
		}
	}

	const status = aggregateInstallerStatus(findings);
	return {
		contract: "deployment.installer-preflight.v1",
		ok: status === "READY",
		status,
		workspaceRoot: options.workspaceRoot,
		nodeVersion,
		...(npmVersion === undefined ? {} : { npmVersion }),
		...(packageManager === undefined
			? {}
			: {
					packageManager: {
						...packageManager,
						...(packageManagerVersion === undefined
							? {}
							: { version: packageManagerVersion }),
					},
				}),
		...(registry === undefined ? {} : { registry }),
		findings,
	};
}

async function inspectWorkspace(workspaceRoot: string): Promise<{
	packageManager?: string;
	findings: InstallerFinding[];
}> {
	const findings: InstallerFinding[] = [];
	try {
		const info = await stat(workspaceRoot);
		if (!info.isDirectory()) {
			return {
				findings: [
					{
						code: "WORKSPACE_INVALID",
						severity: "error",
						message: `${workspaceRoot} is not a directory`,
					},
				],
			};
		}
		await access(workspaceRoot, constants.R_OK | constants.W_OK);
		findings.push({
			code: "WORKSPACE_WRITABLE",
			severity: "info",
			message: `workspace is readable and writable: ${workspaceRoot}`,
		});
	} catch {
		return {
			findings: [
				{
					code: "WORKSPACE_NOT_WRITABLE",
					severity: "error",
					message: `workspace is missing or not writable: ${workspaceRoot}`,
				},
			],
		};
	}

	const manifestPath = join(workspaceRoot, "package.json");
	try {
		const raw = await readFile(manifestPath, "utf8");
		const parsed: unknown = JSON.parse(raw);
		if (!isRecord(parsed))
			throw new Error("package.json root is not an object");
		const manifest = parsed as WorkspacePackageJson;
		findings.push({
			code: "PACKAGE_JSON_READY",
			severity: "info",
			message: "workspace package.json is readable",
		});
		return {
			...(typeof manifest.packageManager === "string"
				? { packageManager: manifest.packageManager }
				: {}),
			findings,
		};
	} catch (error) {
		if (isMissingFile(error)) {
			findings.push({
				code: "PACKAGE_JSON_CREATABLE",
				severity: "info",
				message:
					"workspace has no package.json; installer may create one before the first package mutation",
			});
			return { findings };
		}
		findings.push({
			code: "PACKAGE_JSON_INVALID",
			severity: "error",
			message: error instanceof Error ? error.message : String(error),
		});
		return { findings };
	}
}

function aggregateInstallerStatus(
	findings: readonly InstallerFinding[],
): InstallerPreflightStatus {
	if (findings.some((finding) => finding.severity === "error"))
		return "BLOCKED";
	if (findings.some((finding) => finding.severity === "action")) {
		return "ACTION_REQUIRED";
	}
	return "READY";
}

function platformErrorFinding(
	error: unknown,
	fallbackCode: string,
): InstallerFinding {
	if (error instanceof PlatformError) {
		return { code: error.code, severity: "error", message: error.message };
	}
	return {
		code: fallbackCode,
		severity: "error",
		message: error instanceof Error ? error.message : String(error),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFile(error: unknown): boolean {
	return isRecord(error) && error.code === "ENOENT";
}

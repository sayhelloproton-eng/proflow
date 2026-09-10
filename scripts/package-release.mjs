import { agentMaterialReleaseErrors } from "./agent-material-release-guard.mjs";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { listWorkspacePackages, repositoryRoot } from "./package-selection.mjs";

const execFileAsync = promisify(execFile);
const rawArgs = process.argv.slice(2);
const planOnly = rawArgs.includes("--plan") || rawArgs.includes("--dry-run");
const unknownArgs = rawArgs.filter(
	(arg) => arg !== "--plan" && arg !== "--dry-run",
);
if (unknownArgs.length > 0) {
	throw new TypeError("Usage: pnpm package:release [--plan]");
}
if (rawArgs.includes("--dry-run")) {
	console.warn(
		"--dry-run is retained as a compatibility alias for --plan; no release mutation will occur.",
	);
}

function requireCleanWorkingTree() {
	const status = execFileSync("git", ["status", "--porcelain"], {
		cwd: repositoryRoot,
		encoding: "utf8",
	});
	if (status.trim() !== "") {
		throw new Error(
			"package release requires a clean working tree before version/release",
		);
	}
}
function runReleasePlan() {
	const result = spawnSync("pnpm", ["version", "-r", "--dry-run"], {
		cwd: repositoryRoot,
		encoding: "utf8",
		timeout: 120_000,
	});
	if (result.error) {
		throw new Error(`pnpm release plan failed: ${result.error.message}`);
	}
	if (result.status !== 0) {
		throw new Error(
			`pnpm release plan failed:\n${result.stderr ?? result.stdout ?? ""}`,
		);
	}
	return parseReleasePlan(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
}

function parseReleasePlan(output) {
	const releases = [];
	const pattern =
		/^\s{2}(.+?):\s+(\S+)\s+→\s+(\S+)\s+\(([^,]+),\s+via\s+([^)]+)\)$/;
	for (const line of output.split(/\r?\n/)) {
		const match = line.match(pattern);
		if (!match) continue;
		releases.push({
			selector: match[1],
			fromVersion: match[2],
			version: match[3],
			bump: match[4],
			cause: match[5],
		});
	}
	return releases;
}
function resolveReleaseSet(plan) {
	const workspacePackages = listWorkspacePackages();
	return plan.map((entry) => {
		const pkg = workspacePackages.find(
			(candidate) =>
				candidate.name === entry.selector ||
				`./packages/${candidate.dirName}` === entry.selector,
		);
		if (!pkg) {
			throw new Error(
				`pnpm release plan references unknown workspace package: ${entry.selector}`,
			);
		}
		if (
			pkg.manifest.private === true ||
			pkg.manifest.publishConfig?.access !== "public"
		) {
			throw new Error(`${pkg.name} is not a publishable public package`);
		}
		return { ...pkg, ...entry, name: pkg.name };
	});
}

function latestLedgerReleaseSet() {
	const ledgerPath = ".changeset/ledger.yaml";
	let commit;
	try {
		commit = execFileSync(
			"git",
			["log", "-1", "--format=%H", "--", ledgerPath],
			{
				cwd: repositoryRoot,
				encoding: "utf8",
			},
		).trim();
	} catch {
		return [];
	}
	if (!commit) return [];
	const diff = execFileSync(
		"git",
		["show", "--format=", "--unified=0", commit, "--", ledgerPath],
		{
			cwd: repositoryRoot,
			encoding: "utf8",
		},
	);
	const workspacePackages = listWorkspacePackages();
	const releases = [];
	for (const line of diff.split(/\r?\n/)) {
		const match = line.match(/^\+\s*"(.+@[^"\s]+)":\s*$/);
		if (!match) continue;
		const exact = match[1];
		const separator = exact.lastIndexOf("@");
		if (separator <= 0) continue;
		const name = exact.slice(0, separator);
		const version = exact.slice(separator + 1);
		const pkg = workspacePackages.find((candidate) => candidate.name === name);
		if (!pkg || pkg.manifest.version !== version) continue;
		if (
			pkg.manifest.private === true ||
			pkg.manifest.publishConfig?.access !== "public"
		)
			continue;
		releases.push({
			...pkg,
			selector: name,
			fromVersion: version,
			version,
			bump: "already-versioned",
			cause: `ledger:${commit.slice(0, 7)}`,
		});
	}
	return releases;
}

function printReleaseSet(label, releases) {
	console.log(label);
	for (const item of releases) {
		console.log(
			`  ${item.name}: ${item.fromVersion} → ${item.version} (${item.bump}, ${item.cause})`,
		);
	}
}

async function registryExact(item) {
	const exact = `${item.name}@${item.version}`;
	try {
		const { stdout } = await execFileAsync(
			"npm",
			["view", exact, "version", "--json", "--prefer-online"],
			{ cwd: repositoryRoot, timeout: 30_000, maxBuffer: 1024 * 1024 },
		);
		const parsed = JSON.parse(stdout || "null");
		if (typeof parsed !== "string") {
			throw new Error(`Registry exact response invalid for ${exact}`);
		}
		return parsed;
	} catch (error) {
		const diagnostic = `${error?.stdout ?? ""}\n${error?.stderr ?? ""}\n${error?.message ?? ""}`;
		if (/\bE404\b|404 Not Found/i.test(diagnostic)) return undefined;
		throw new Error(
			`Registry exact query is UNKNOWN for ${exact}; refuse to publish`,
		);
	}
}

async function missingFromRegistry(releases) {
	const observed = await Promise.all(
		releases.map(async (item) => ({
			item,
			version: await registryExact(item),
		})),
	);
	return observed
		.filter(({ item, version }) => version !== item.version)
		.map(({ item }) => item);
}

function verifyAppliedVersions(releases) {
	const current = listWorkspacePackages();
	for (const item of releases) {
		const pkg = current.find((candidate) => candidate.name === item.name);
		if (!pkg || pkg.manifest.version !== item.version) {
			throw new Error(
				`${item.name}: pnpm version did not apply expected ${item.version}`,
			);
		}
	}
}

function commitVersionFacts(releases) {
	execFileSync("git", ["diff", "--check"], {
		cwd: repositoryRoot,
		stdio: "inherit",
	});
	execFileSync("git", ["add", "-A"], { cwd: repositoryRoot, stdio: "inherit" });
	const staged = execFileSync("git", ["diff", "--cached", "--name-only"], {
		cwd: repositoryRoot,
		encoding: "utf8",
	}).trim();
	if (!staged) return;
	const names = releases
		.map((item) => item.name.replace("@tomflow/proflow-", ""))
		.join(", ");
	execFileSync("git", ["commit", "-m", `chore(release): version ${names}`], {
		cwd: repositoryRoot,
		stdio: "inherit",
	});
}
function runSelectedBuildAndPublishability(releases) {
	const selectors = releases.map((item) => item.dirName);
	execFileSync(
		process.execPath,
		["scripts/release-sync-versions.mjs", "--check", ...selectors],
		{
			cwd: repositoryRoot,
			stdio: "inherit",
		},
	);
	execFileSync(process.execPath, ["scripts/build-packages.mjs", ...selectors], {
		cwd: repositoryRoot,
		stdio: "inherit",
	});
	execFileSync(process.execPath, ["scripts/publishability.mjs", ...selectors], {
		cwd: repositoryRoot,
		stdio: "inherit",
	});
}

async function publishMissing(releases) {
	const missing = await missingFromRegistry(releases);
	if (missing.length === 0) {
		console.log(
			"Registry exact already contains every release target; nothing to publish.",
		);
		return;
	}
	printReleaseSet("Registry MISSING release set:", missing);
	runSelectedBuildAndPublishability(missing);
	requireCleanWorkingTree();
	const args = ["publish", "-r", "--no-git-checks"];
	for (const item of missing) args.push("--filter", item.name);
	const result = spawnSync("pnpm", args, {
		cwd: repositoryRoot,
		stdio: "inherit",
		timeout: 10 * 60_000,
	});
	if (result.error || result.status !== 0) {
		const remaining = await missingFromRegistry(missing);
		if (remaining.length > 0) {
			throw new Error(
				`publish returned UNKNOWN/FAIL and Registry still misses: ${remaining.map((item) => `${item.name}@${item.version}`).join(", ")}`,
			);
		}
		console.warn(
			"publish command returned UNKNOWN/FAIL, but authoritative Registry readback confirms all targets exist.",
		);
	}
	const remaining = await missingFromRegistry(releases);
	if (remaining.length > 0) {
		throw new Error(
			`Registry exact readback failed: ${remaining.map((item) => `${item.name}@${item.version}`).join(", ")}`,
		);
	}
	for (const item of releases) {
		console.log(`Registry exact PASS: ${item.name}@${item.version}`);
	}
}

const materialErrors = await agentMaterialReleaseErrors(repositoryRoot);
if (materialErrors.length) throw new Error(materialErrors.join("\n"));

let releaseSet = resolveReleaseSet(runReleasePlan());
let mode = "pending-changeset";
if (releaseSet.length === 0) {
	releaseSet = latestLedgerReleaseSet();
	mode = "versioned-resume";
}

if (releaseSet.length === 0) {
	console.log(
		"No pending changeset release and no resumable versioned release found.",
	);
	process.exit(0);
}

printReleaseSet(
	mode === "pending-changeset"
		? "pnpm changeset release plan:"
		: "Resumable release set from latest changeset ledger commit:",
	releaseSet,
);

if (planOnly) {
	const missing = await missingFromRegistry(releaseSet);
	if (missing.length === 0)
		console.log("Registry state: all targets already published.");
	else printReleaseSet("Registry MISSING:", missing);
	process.exit(0);
}

requireCleanWorkingTree();
if (mode === "pending-changeset") {
	execFileSync("pnpm", ["version", "-r"], {
		cwd: repositoryRoot,
		stdio: "inherit",
	});
	const selectors = releaseSet.map((item) => item.dirName);
	execFileSync(
		process.execPath,
		["scripts/release-sync-versions.mjs", "--write", ...selectors],
		{ cwd: repositoryRoot, stdio: "inherit" },
	);
	verifyAppliedVersions(releaseSet);
	commitVersionFacts(releaseSet);
	requireCleanWorkingTree();
} else {
	verifyAppliedVersions(releaseSet);
	execFileSync(
		process.execPath,
		[
			"scripts/release-sync-versions.mjs",
			"--check",
			...releaseSet.map((item) => item.dirName),
		],
		{ cwd: repositoryRoot, stdio: "inherit" },
	);
}

await publishMissing(releaseSet);
console.log(
	`Package release PASS (${mode}): ${releaseSet.map((item) => `${item.name}@${item.version}`).join(", ")}`,
);

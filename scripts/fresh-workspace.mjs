import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";

const argv = process.argv.slice(2);
const valueAfter = (flag) => {
	const index = argv.indexOf(flag);
	return index >= 0 ? argv[index + 1] : undefined;
};
const workspaceArg = valueAfter("--workspace");
const dryRun = argv.includes("--dry-run");
const skipStop = argv.includes("--skip-stop");

if (!workspaceArg) {
	console.error(
		"Usage: pnpm fresh:workspace --workspace <absolute-path> [--dry-run]",
	);
	process.exit(2);
}

const workspace = realpathSync(resolve(workspaceArg));
const repositoryRoot = realpathSync(resolve(import.meta.dirname, ".."));
if (
	workspace === "/" ||
	workspace === homedir() ||
	workspace === repositoryRoot
) {
	throw new Error(`Refusing unsafe workspace: ${workspace}`);
}

const protectedRepo = join(workspace, "repos", "proflow");
const packageJsonPath = join(workspace, "package.json");
const hasKnownMarker =
	existsSync(join(workspace, ".proflow")) ||
	existsSync(
		join(workspace, "node_modules", "@tomflow", "proflow-platform-cli"),
	) ||
	existsSync(protectedRepo);
if (!hasKnownMarker)
	throw new Error("Refusing workspace without a ProFlow marker");

if (existsSync(packageJsonPath)) {
	const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8"));
	if (manifest.scripts && Object.keys(manifest.scripts).length > 0) {
		throw new Error("Refusing to delete package.json with user scripts");
	}
	for (const field of [
		"dependencies",
		"devDependencies",
		"optionalDependencies",
		"peerDependencies",
	]) {
		for (const name of Object.keys(manifest[field] ?? {})) {
			if (!name.startsWith("@tomflow/proflow-")) {
				throw new Error(`Refusing non-ProFlow dependency in ${field}: ${name}`);
			}
		}
	}
}

const cleanupNames = [
	".proflow",
	"node_modules",
	"package.json",
	"package-lock.json",
	"npm-shrinkwrap.json",
	"pnpm-lock.yaml",
	"pnpm-workspace.yaml",
	"releases",
];
const cleanupTargets = cleanupNames.map((name) => join(workspace, name));
for (const target of cleanupTargets) {
	const rel = relative(workspace, target);
	if (rel.startsWith("..") || rel === "")
		throw new Error(`Unsafe cleanup target: ${target}`);
}

const platformBin = join(workspace, "node_modules", ".bin", "platform");
if (!skipStop && existsSync(platformBin)) {
	if (dryRun) {
		console.log(`[dry-run] stop: ${platformBin} stop --workspace ${workspace}`);
	} else {
		const stopped = spawnSync(platformBin, ["stop", "--workspace", workspace], {
			cwd: workspace,
			encoding: "utf8",
			stdio: "inherit",
		});
		if (stopped.error) throw stopped.error;
		if (stopped.status !== 0)
			throw new Error(`platform stop failed with status ${stopped.status}`);
	}
}

for (const target of cleanupTargets) {
	if (!existsSync(target)) continue;
	if (dryRun) console.log(`[dry-run] remove: ${target}`);
	else rmSync(target, { recursive: true, force: true });
}

if (!dryRun) {
	const leftovers = cleanupTargets.filter((target) => existsSync(target));
	if (leftovers.length > 0)
		throw new Error(`Fresh hygiene failed: ${leftovers.join(", ")}`);
}

console.log(
	`${dryRun ? "Fresh Workspace DRY-RUN PASS" : "Fresh Workspace READY"}: ${workspace}`,
);
console.log(
	`Protected: ${existsSync(join(workspace, "repos")) ? "repos/" : "no repos/ directory"}`,
);

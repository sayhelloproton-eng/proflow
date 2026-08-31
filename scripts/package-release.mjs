import { execFileSync, spawnSync } from "node:child_process";
import { resolveRequestedPackages, repositoryRoot } from "./package-selection.mjs";

const raw = process.argv.slice(2);
const planOnly = raw.includes("--plan");
const dryRun = raw.includes("--dry-run");
const requested = raw.filter((arg) => !arg.startsWith("--"));
const packages = resolveRequestedPackages(
  requested,
  "Usage: pnpm package:release <package-dir|package-name> [...] [--plan|--dry-run]",
);

for (const pkg of packages) {
  if (pkg.manifest.private === true || pkg.manifest.publishConfig?.access !== "public") {
    throw new Error(`${pkg.name} is not a publishable public package`);
  }
  if (typeof pkg.manifest.version !== "string" || pkg.manifest.version.length === 0) {
    throw new Error(`${pkg.name} has no publishable version`);
  }
}

console.log(`Package release targets: ${packages.map((pkg) => `${pkg.name}@${pkg.manifest.version}`).join(", ")}`);
console.log("Pipeline: version-sync check -> selected build -> selected publishability -> exact Registry preflight -> selected publish -> exact Registry readback");
if (planOnly) process.exit(0);

const gitStatus = execFileSync("git", ["status", "--porcelain"], { cwd: repositoryRoot, encoding: "utf8" });
if (gitStatus.trim() !== "") {
  throw new Error("package release requires a clean working tree; commit the package change/version facts first");
}

const selectors = packages.map((pkg) => pkg.dirName);
execFileSync(process.execPath, ["scripts/release-sync-versions.mjs", "--check", ...selectors], { cwd: repositoryRoot, stdio: "inherit" });
execFileSync(process.execPath, ["scripts/build-packages.mjs", ...selectors], { cwd: repositoryRoot, stdio: "inherit" });
execFileSync(process.execPath, ["scripts/publishability.mjs", ...selectors], { cwd: repositoryRoot, stdio: "inherit" });

function registryVersion(pkg) {
  const exact = `${pkg.name}@${pkg.manifest.version}`;
  const result = spawnSync("npm", ["view", exact, "version", "--json", "--prefer-online"], {
    cwd: repositoryRoot, encoding: "utf8", timeout: 30_000,
  });
  if (result.error) throw new Error(`Registry exact query failed for ${exact}: ${result.error.message}`);
  if (result.status !== 0) {
    const diagnostic = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    if (/\bE404\b|404 Not Found/i.test(diagnostic)) return undefined;
    throw new Error(`Registry exact query is UNKNOWN for ${exact}; refuse to publish`);
  }
  const parsed = JSON.parse(result.stdout || "null");
  if (typeof parsed !== "string") throw new Error(`Registry exact response invalid for ${exact}`);
  return parsed;
}

for (const pkg of packages) {
  const exact = `${pkg.name}@${pkg.manifest.version}`;
  const before = registryVersion(pkg);
  if (before === pkg.manifest.version) {
    console.log(`Registry exact already exists, skip publish: ${exact}`);
    continue;
  }
  const args = ["--dir", pkg.directory, "publish", "--no-git-checks"];
  if (dryRun) args.push("--dry-run");
  execFileSync("pnpm", args, { cwd: repositoryRoot, stdio: "inherit" });
  if (dryRun) {
    console.log(`Dry-run publish PASS: ${exact}`);
    continue;
  }
  const after = registryVersion(pkg);
  if (after !== pkg.manifest.version) throw new Error(`Registry readback failed after publish: ${exact}`);
  console.log(`Registry exact PASS: ${exact}`);
}

console.log(`Package release ${dryRun ? "DRY-RUN " : ""}PASS: ${packages.map((pkg) => pkg.dirName).join(", ")}`);

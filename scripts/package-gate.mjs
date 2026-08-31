import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const packagesRoot = join(repositoryRoot, "packages");
const requested = process.argv.slice(2);

if (requested.length === 0) {
  console.error("Usage: pnpm package:gate <package-dir|package-name> [...]");
  process.exit(2);
}

const packages = readdirSync(packagesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    const directory = join(packagesRoot, entry.name);
    const packageJsonPath = join(directory, "package.json");
    if (!existsSync(packageJsonPath)) return null;
    const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    return { dirName: entry.name, directory, name: manifest.name, scripts: manifest.scripts ?? {} };
  })
  .filter(Boolean);

for (const request of requested) {
  const pkg = packages.find((candidate) => candidate.dirName === request || candidate.name === request);
  if (!pkg) {
    console.error(`Unknown package: ${request}`);
    process.exit(2);
  }
  for (const required of ["test", "typecheck"]) {
    if (!pkg.scripts[required]) {
      console.error(`${pkg.name} is missing required package gate script: ${required}`);
      process.exit(2);
    }
  }

  console.log(`\n== Package gate: ${pkg.name} ==`);
  execFileSync("pnpm", ["--dir", pkg.directory, "test"], { stdio: "inherit" });
  execFileSync("pnpm", ["--dir", pkg.directory, "typecheck"], { stdio: "inherit" });
  if (pkg.scripts.lint) {
    execFileSync("pnpm", ["--dir", pkg.directory, "lint"], { stdio: "inherit" });
  }
}

console.log(`\nPackage gate PASS: ${requested.join(", ")}`);

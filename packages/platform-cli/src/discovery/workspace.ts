import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { PlatformError } from "../errors.ts";

const PRUNE_DIRS = new Set([
	"node_modules",
	".git",
	".proflow",
	"dist",
	".omo",
	".codegraph",
]);

export function findWorkspaceRoot(fromUrl: string = import.meta.url): string {
	let dir = dirname(fileURLToPath(fromUrl));
	for (;;) {
		if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) {
			throw new PlatformError(
				"INVALID_REQUEST",
				"pnpm-workspace.yaml not found in any parent directory",
			);
		}
		dir = parent;
	}
}

export async function readWorkspaceGlobs(root: string): Promise<string[]> {
	const file = join(root, "pnpm-workspace.yaml");
	let raw: string;
	try {
		raw = await readFile(file, "utf8");
	} catch {
		return [];
	}
	const globs: string[] = [];
	let inPackages = false;
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (trimmed === "" || trimmed.startsWith("#")) continue;
		if (/^packages\s*:/.test(trimmed)) {
			inPackages = true;
			const inline = /^packages\s*:\s*\[(.*)\]$/.exec(trimmed);
			if (inline !== null) {
				const body = inline[1] ?? "";
				for (const match of body.matchAll(/"([^"]*)"|'([^']*)'/g)) {
					const value = match[1] ?? match[2];
					if (value !== undefined && value !== "") globs.push(value);
				}
				inPackages = false;
			}
			continue;
		}
		if (!inPackages) continue;
		if (!/^\s/.test(line) && !trimmed.startsWith("-")) {
			inPackages = false;
			continue;
		}
		const match = /^\s*-\s*(?:"([^"]*)"|'([^']*)'|([^\s#]+))/.exec(line);
		if (match !== null) {
			const value = match[1] ?? match[2] ?? match[3];
			if (value !== undefined) globs.push(value);
		}
	}
	return globs;
}

function globToRegExp(glob: string): RegExp {
	const segments = glob.split("/");
	let pattern = "^";
	for (let index = 0; index < segments.length; index += 1) {
		if (index > 0) pattern += "/";
		const segment = segments[index] ?? "";
		if (segment === "**") {
			pattern += ".*";
			continue;
		}
		pattern += segment
			.replace(/[.+^${}()|[\]\\]/g, "\\$&")
			.replace(/\*\*/g, ".*")
			.replace(/\*/g, "[^/]*")
			.replace(/\?/g, "[^/]");
	}
	pattern += "$";
	return new RegExp(pattern);
}

function globStaticPrefix(glob: string): string {
	const magic = glob.search(/[*?[\]]/);
	if (magic === -1) return glob;
	const prefix = glob.slice(0, magic);
	const lastSlash = prefix.lastIndexOf("/");
	if (lastSlash === -1) return ".";
	const base = prefix.slice(0, lastSlash);
	return base === "" ? "/" : base;
}

async function walkMatchingDirs(
	base: string,
	root: string,
	regex: RegExp,
): Promise<string[]> {
	const found: string[] = [];
	const entries = await readdir(base, { withFileTypes: true }).catch(() => []);
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		if (PRUNE_DIRS.has(entry.name)) continue;
		const full = join(base, entry.name);
		const rel = relative(root, full).split(sep).join("/");
		if (regex.test(rel)) found.push(full);
		found.push(...(await walkMatchingDirs(full, root, regex)));
	}
	return found;
}

export async function expandPackageDirs(
	root: string,
	globs: readonly string[],
): Promise<string[]> {
	const found = new Set<string>();
	for (const rawGlob of globs) {
		const glob = rawGlob.replace(/\\/g, "/").replace(/^\.\//, "");
		if (glob === "") continue;
		if (!/[*?[\]]/.test(glob)) {
			const absolute = resolve(root, glob);
			try {
				const info = await stat(absolute);
				if (info.isDirectory()) found.add(absolute);
			} catch {
				// ignore missing literal paths
			}
			continue;
		}
		const regex = globToRegExp(glob);
		const base = resolve(root, globStaticPrefix(glob));
		for (const dir of await walkMatchingDirs(base, root, regex)) {
			found.add(dir);
		}
	}
	return [...found].sort();
}

export function hasDeploymentArtifacts(dir: string): boolean {
	return (
		existsSync(join(dir, "deployment", "descriptor.ts")) &&
		existsSync(join(dir, "deployment", "adapter.ts"))
	);
}

export interface PackageJson {
	name?: string;
	version?: string;
}

export async function readPackageJson(dir: string): Promise<PackageJson> {
	try {
		const raw = await readFile(join(dir, "package.json"), "utf8");
		return JSON.parse(raw) as PackageJson;
	} catch {
		return {};
	}
}

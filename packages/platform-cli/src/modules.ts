export interface ModuleSource {
	type: "workspace" | "installed";
	packageName: string;
	// source path to the package root (workspace) or resolved entry (installed)
	path?: string;
}

export interface ModuleCatalog {
	sources(): Promise<ModuleSource[]>;
	loadDescriptor(source: ModuleSource): Promise<unknown>;
	loadAdapter(source: ModuleSource): Promise<unknown>;
}

// Minimal private semver range matcher — supports exact, >=, >, <=, <, and
// whitespace-separated comparator combinations. Not a general resolver.
function parseSemver(value: string): [number, number, number] | null {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
	if (match === null) return null;
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemver(
	a: [number, number, number],
	b: [number, number, number],
): number {
	for (let i = 0; i < 3; i += 1) {
		const left = a[i] ?? 0;
		const right = b[i] ?? 0;
		if (left < right) return -1;
		if (left > right) return 1;
	}
	return 0;
}

export function versionSatisfies(version: string, range: string): boolean {
	const parsed = parseSemver(version);
	if (parsed === null) return false;
	const parts = range
		.trim()
		.split(/\s+/)
		.filter((part) => part.length > 0);
	if (parts.length === 0) return false;
	return parts.every((part) => {
		if (part === "*") return true;
		const match = /^(>=|<=|>|<|=)?(.+)$/.exec(part);
		const op = match?.[1] ?? "=";
		const rest = match?.[2] ?? "";
		const target = parseSemver(rest);
		if (target === null) return false;
		const cmp = compareSemver(parsed, target);
		switch (op) {
			case ">=":
				return cmp >= 0;
			case ">":
				return cmp > 0;
			case "<=":
				return cmp <= 0;
			case "<":
				return cmp < 0;
			case "=":
				return cmp === 0;
			default:
				return false;
		}
	});
}

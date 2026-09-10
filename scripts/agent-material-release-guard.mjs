import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";

export const agentMaterialPackages = ["agent-product", "agent-controller-dev", "agent-test-ops"];
const baselinePath = ".changeset/agent-material-baseline.json";
function stable(value) {
	if (Array.isArray(value)) return value.map(stable);
	if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
	return value;
}

export async function agentMaterialSource(root, dir) {
	const packageRoot = resolve(root, "packages", dir);
	const manifest = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
	const files = [];
	async function collect(path) {
		let entries;
		try { entries = await readdir(path, { withFileTypes: true }); }
		catch (error) { if (error.code === "ENOENT") return; throw error; }
		for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
			const target = resolve(path, entry.name);
			if (entry.isSymbolicLink()) throw new Error("AGENT_MATERIAL_SYMLINK_UNSUPPORTED");
			if (entry.isDirectory()) await collect(target);
			else if (entry.isFile()) files.push([relative(packageRoot, target).replaceAll("\\", "/"), createHash("sha256").update(await readFile(target)).digest("hex")]);
		}
	}
	for (const asset of ["actions", "context", "memory", "knowledge", "src", "deployment"]) await collect(resolve(packageRoot, asset));
	const material = stable({ name: manifest.name, description: manifest.description, proflowAgent: manifest.proflowAgent, files: files.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0) });
	return { packageName: manifest.name, version: manifest.version, fingerprint: `sha256:${createHash("sha256").update(JSON.stringify(material)).digest("hex")}` };
}

export async function agentMaterialReleaseErrors(root, options = {}) {
	const baseline = JSON.parse(await readFile(resolve(root, baselinePath), "utf8"));
	const intents = [];
	for (const name of await readdir(resolve(root, ".changeset"))) {
		if (!name.endsWith(".md")) continue;
		const content = await readFile(resolve(root, ".changeset", name), "utf8");
		const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)?.[1];
		if (header) intents.push(header);
	}
	const errors = [];
	for (const dir of agentMaterialPackages.filter((name) => !options.selectedDirs || options.selectedDirs.includes(name))) {
		const current = await agentMaterialSource(root, dir);
		const previous = baseline[dir];
		if (!previous) { errors.push(`${dir}: released material baseline missing`); continue; }
		if (previous.version === current.version && previous.fingerprint === current.fingerprint) continue;
		const escaped = current.packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const hasIntent = intents.some((header) => new RegExp(`^\\s*["']?${escaped}["']?\\s*:\\s*(patch|minor|major)\\s*$`, "m").test(header));
		if (options.requireReleased || !hasIntent) errors.push(`${current.packageName}: AGENT_MATERIAL_RELEASE_INTENT_REQUIRED (baseline ${previous.version}, current ${current.version}); release must refresh its baseline`);
	}
	return errors;
}

/** Called only after version/ledger application by the formal release workflow. */
export async function recordReleasedAgentMaterials(root, selectedDirs, options = {}) {
	const baseline = JSON.parse(await readFile(resolve(root, baselinePath), "utf8"));
	const ledger = await readFile(resolve(root, ".changeset/ledger.yaml"), "utf8");
	for (const dir of agentMaterialPackages.filter((name) => selectedDirs.includes(name))) {
		const current = await agentMaterialSource(root, dir);
		if (options.skipUnchanged && baseline[dir]?.version === current.version) continue;
		const before = /^(\d+)\.(\d+)\.(\d+)$/.exec(baseline[dir]?.version ?? "")?.slice(1).map(Number);
		const after = /^(\d+)\.(\d+)\.(\d+)$/.exec(current.version)?.slice(1).map(Number);
		const firstDifference = before && after ? before.findIndex((value, index) => value !== after[index]) : -1;
		if (!before || !after || firstDifference < 0 || after[firstDifference] < before[firstDifference]) throw new Error(`${dir}: AGENT_MATERIAL_VERSION_NOT_ADVANCED`);
		if (!ledger.includes(`"${current.packageName}@${current.version}":`)) throw new Error(`${dir}: AGENT_MATERIAL_RELEASE_LEDGER_MISSING`);
		baseline[dir] = current;
	}
	await writeFile(resolve(root, baselinePath), `${JSON.stringify(baseline, null, 2)}\n`);
}

import { readdir, readFile, writeFile } from "node:fs/promises";

const mode = process.argv[2] ?? "--check";
if (mode !== "--check" && mode !== "--write") {
	throw new TypeError(
		"Usage: node scripts/release-sync-versions.mjs [--check|--write]",
	);
}

const packagesRoot = new URL("../packages/", import.meta.url);
const packageDirectories = (
	await readdir(packagesRoot, { withFileTypes: true })
)
	.filter((entry) => entry.isDirectory())
	.map((entry) => entry.name)
	.sort();

const drifts = [];
const writes = [];

async function readJson(path) {
	return JSON.parse(await readFile(path, "utf8"));
}

function recordDrift(packageName, target, actual, expected) {
	drifts.push({ packageName, target, actual, expected });
}

async function syncJsonField({ packageName, path, field, expected }) {
	const data = await readJson(path);
	const actual = data[field];
	if (actual === expected) return;
	recordDrift(packageName, path.pathname, actual, expected);
	if (mode === "--write") {
		data[field] = expected;
		writes.push(
			writeFile(path, `${JSON.stringify(data, null, "\t")}\n`, "utf8"),
		);
	}
}

async function syncDescriptor({ packageName, path, expected }) {
	const source = await readFile(path, "utf8");
	const pattern = /moduleVersion:\s*"[^"]+"/;
	const match = source.match(pattern);
	if (!match)
		throw new Error(`${packageName}: descriptor has no moduleVersion literal`);
	const wanted = `moduleVersion: ${JSON.stringify(expected)}`;
	if (match[0] === wanted) return;
	recordDrift(packageName, path.pathname, match[0], wanted);
	if (mode === "--write") {
		writes.push(writeFile(path, source.replace(pattern, wanted), "utf8"));
	}
}

for (const directory of packageDirectories) {
	const packageRoot = new URL(`${directory}/`, packagesRoot);
	const packageJsonPath = new URL("package.json", packageRoot);
	let packageJson;
	try {
		packageJson = await readJson(packageJsonPath);
	} catch {
		continue;
	}
	if (
		typeof packageJson.name !== "string" ||
		!packageJson.name.startsWith("@tomflow/proflow-") ||
		typeof packageJson.version !== "string"
	) {
		continue;
	}

	const version = packageJson.version;
	await syncJsonField({
		packageName: packageJson.name,
		path: new URL("proflow.module.json", packageRoot),
		field: "moduleVersion",
		expected: version,
	});
	await syncDescriptor({
		packageName: packageJson.name,
		path: new URL("deployment/descriptor.ts", packageRoot),
		expected: version,
	});

	if (packageJson.name === "@tomflow/proflow-execution-browser-extension") {
		await syncJsonField({
			packageName: packageJson.name,
			path: new URL("manifest.json", packageRoot),
			field: "version",
			expected: version,
		});
	}
}

await Promise.all(writes);

if (mode === "--write" && drifts.length > 0) {
	console.log(
		`Release version sync updated ${drifts.length} package-owned version facts.`,
	);
	process.exit(0);
}

if (drifts.length > 0) {
	for (const drift of drifts) {
		console.error(
			`VERSION_DRIFT ${drift.packageName} ${drift.target}: ${JSON.stringify(drift.actual)} -> ${JSON.stringify(drift.expected)}`,
		);
	}
	process.exit(1);
}

console.log(
	`Release version sync PASS: ${packageDirectories.length} workspace package directories checked.`,
);

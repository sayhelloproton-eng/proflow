import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

const ROOT = process.cwd();
const mode = process.argv.includes("--write") ? "write" : "check";

async function exists(path) {
	try {
		return (await stat(path)).isFile();
	} catch {
		return false;
	}
}
function rel(path) {
	return relative(ROOT, path).replaceAll("\\", "/");
}
function uniq(values) {
	return [...new Set(values)].sort();
}
function sourceForDist(packageDir, target) {
	if (
		typeof target !== "string" ||
		!target.startsWith("./dist/") ||
		!target.endsWith(".js")
	)
		return null;
	return resolve(
		packageDir,
		target.slice("./dist/".length).replace(/\.js$/, ".ts"),
	);
}
function publicSymbols(source) {
	const names = [];
	for (const match of source.matchAll(
		/\bexport\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g,
	))
		names.push(match[1]);
	for (const match of source.matchAll(/\bexport\s*\{([^}]+)\}/g)) {
		for (const part of match[1].split(",")) {
			const cleaned = part.trim().replace(/^type\s+/, "");
			if (!cleaned) continue;
			const alias = cleaned.match(/\bas\s+([A-Za-z_$][\w$]*)$/)?.[1];
			names.push(alias ?? cleaned.split(/\s+/)[0]);
		}
	}
	return uniq(names.filter(Boolean));
}
function operationIds(yaml) {
	return uniq(
		[...yaml.matchAll(/^\s*operationId:\s*([^\s#]+)\s*$/gm)].map((m) => m[1]),
	);
}
function parseHostRoleOperations(source) {
	const result = {};
	const block =
		source.match(
			/export const roleOperations:[\s\S]*?=\s*\{([\s\S]*?)\n\};/,
		)?.[1] ?? "";
	const re =
		/"(@tomflow\/proflow-agent-[^"]+)"\s*:\s*new Set\(\[([\s\S]*?)\]\)/g;
	for (const match of block.matchAll(re))
		result[match[1]] = uniq(
			[...match[2].matchAll(/"([A-Za-z][A-Za-z0-9]+)"/g)].map((m) => m[1]),
		);
	return result;
}
function diff(left, right) {
	const r = new Set(right);
	return left.filter((item) => !r.has(item));
}

async function main() {
	const errors = [];
	const packagesRoot = resolve(ROOT, "packages");
	const packageDirs = (await readdir(packagesRoot, { withFileTypes: true }))
		.filter((e) => e.isDirectory())
		.map((e) => resolve(packagesRoot, e.name))
		.sort();
	const packages = [];
	for (const dir of packageDirs) {
		const manifestPath = resolve(dir, "package.json");
		if (!(await exists(manifestPath))) continue;
		const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
		const exportEntries = [];
		for (const [key, target] of Object.entries(manifest.exports ?? {})) {
			const source = sourceForDist(dir, target);
			const sourceExists = source ? await exists(source) : false;
			if (!sourceExists)
				errors.push(
					`${manifest.name}: export ${key} has no source target for ${target}`,
				);
			exportEntries.push({
				key,
				target,
				source: source ? rel(source) : null,
				classification: sourceExists
					? "SHIPPED_PUBLIC_EXPORT"
					: "MISSING_SOURCE_TARGET",
			});
		}
		const binaries = [];
		for (const [name, target] of Object.entries(manifest.bin ?? {})) {
			const source = sourceForDist(dir, target);
			const sourceExists = source ? await exists(source) : false;
			if (!sourceExists)
				errors.push(
					`${manifest.name}: binary ${name} has no source target for ${target}`,
				);
			binaries.push({
				name,
				target,
				source: source ? rel(source) : null,
				classification: sourceExists
					? "SHIPPED_BINARY"
					: "MISSING_SOURCE_TARGET",
			});
		}
		const indexPath = resolve(dir, "src/index.ts");
		const symbols = (await exists(indexPath))
			? publicSymbols(await readFile(indexPath, "utf8"))
			: [];
		packages.push({
			package: manifest.name,
			exports: exportEntries,
			binaries,
			publicIndexSymbols: symbols,
			classification: "CLASSIFIED",
		});
	}

	const rolePackages = [
		"agent-product",
		"agent-controller-dev",
		"agent-test-ops",
	];
	const hostRoleSource = await readFile(
		resolve(ROOT, "packages/platform-host/src/role-operations.ts"),
		"utf8",
	);
	const hostRoles = parseHostRoleOperations(hostRoleSource);
	const roles = [];
	for (const pkg of rolePackages) {
		const manifest = JSON.parse(
			await readFile(resolve(ROOT, `packages/${pkg}/package.json`), "utf8"),
		);
		const yamlPath = resolve(
			ROOT,
			`packages/${pkg}/actions/custom-gpt.openapi.yaml`,
		);
		const openApi = operationIds(await readFile(yamlPath, "utf8"));
		const host = hostRoles[manifest.name] ?? [];
		const missingInHost = diff(openApi, host);
		const missingInOpenApi = diff(host, openApi);
		if (missingInHost.length || missingInOpenApi.length)
			errors.push(`${manifest.name}: OpenAPI/Host ACL drift`);
		roles.push({
			package: manifest.name,
			openApiOperationIds: openApi,
			hostAuthorizedOperations: host,
			missingInHost,
			missingInOpenApi,
			classification:
				missingInHost.length || missingInOpenApi.length
					? "OWNER_DRIFT"
					: "EXACT_MATCH",
		});
	}

	const background = await readFile(
		resolve(
			ROOT,
			"packages/execution-browser-extension/extension/background.ts",
		),
		"utf8",
	);
	const panelTs = await readFile(
		resolve(
			ROOT,
			"packages/execution-browser-extension/extension/side-panel.ts",
		),
		"utf8",
	);
	const panelHtml = await readFile(
		resolve(
			ROOT,
			"packages/execution-browser-extension/extension/side-panel.html",
		),
		"utf8",
	);
	const optionsHtml = await readFile(
		resolve(
			ROOT,
			"packages/execution-browser-extension/extension/options.html",
		),
		"utf8",
	);
	const messageTypes = uniq(
		[...`${background}\n${panelTs}`.matchAll(/"(PROFLOW_[A-Z0-9_]+)"/g)].map(
			(m) => m[1],
		),
	);
	const applicationOperations = uniq(
		[
			...panelTs.matchAll(
				/(?:taskApplication|approvalApplication)\("([a-z][A-Za-z0-9.]+)"/g,
			),
		].map((m) => m[1]),
	);
	const staticButtons = [
		...panelHtml.matchAll(/<button\s+id="([^"]+)"[^>]*>([^<]+)<\/button>/g),
	].map((m) => ({
		id: m[1],
		label: m[2].trim(),
		classification: "SHIPPED_UI_CONTROL",
	}));
	const staticForms = [...panelHtml.matchAll(/<form\s+id="([^"]+)"/g)].map(
		(m) => ({ id: m[1], classification: "SHIPPED_UI_FORM" }),
	);
	const optionForms = [...optionsHtml.matchAll(/<form\s+id="([^"]+)"/g)].map(
		(m) => ({ id: m[1], classification: "SHIPPED_CONFIG_FORM" }),
	);
	const dynamicControls = [
		{ label: "Allow", operation: "approval.allow" },
		{ label: "Deny", operation: "approval.deny" },
		{ label: "Reopen", operation: "node.reopen" },
		{ label: "Task row open", operation: "task.get" },
	].map((item) => ({
		...item,
		classification: applicationOperations.includes(item.operation)
			? "SHIPPED_UI_CONTROL"
			: "MISSING_HANDLER",
	}));
	for (const item of dynamicControls)
		if (item.classification === "MISSING_HANDLER")
			errors.push(`UI dynamic control missing operation: ${item.operation}`);

	const publicArtifact = {
		contract: "proflow.public-surface-reconciliation.v1",
		semantics:
			"Mechanical inventory of shipped public package exports/binaries, Role OpenAPI operations, Host runtime ACL, Extension message types and application operations. Inventory presence is not execution PASS evidence.",
		packages,
		roleActionReconciliation: roles,
		extension: { messageTypes, applicationOperations },
		gate: {
			unclassified: 0,
			ownerDrift: roles.filter((r) => r.classification === "OWNER_DRIFT")
				.length,
			missingSourceTargets: packages
				.flatMap((p) => [...p.exports, ...p.binaries])
				.filter((e) => e.classification === "MISSING_SOURCE_TARGET").length,
		},
	};
	const uiArtifact = {
		contract: "proflow.ui-interaction-reconciliation.v1",
		semantics:
			"Mechanical shipped UI inventory. Controls prove an implemented interaction surface only; real Chrome/Custom GPT behavior remains REAL_EXTERNAL where applicable.",
		sidePanel: {
			forms: staticForms,
			staticButtons,
			dynamicControls,
			applicationOperations,
		},
		options: { forms: optionForms },
		gate: {
			unclassified: 0,
			missingHandlers: dynamicControls.filter(
				(item) => item.classification === "MISSING_HANDLER",
			).length,
		},
	};

	const evidenceDir = resolve(
		ROOT,
		"spec/平台架构与公共约定/08-测试用例与验证",
	);
	const targets = [
		[
			resolve(evidenceDir, "BATCH6-PUBLIC-SURFACE-RECONCILIATION.json"),
			publicArtifact,
		],
		[
			resolve(evidenceDir, "BATCH6-UI-INTERACTION-RECONCILIATION.json"),
			uiArtifact,
		],
	];
	const serialise = (value) => `${JSON.stringify(value, null, 2)}\n`;
	for (const [path, artifact] of targets) {
		if (mode === "write") await writeFile(path, serialise(artifact), "utf8");
		else {
			let actual = null;
			try {
				actual = await readFile(path, "utf8");
			} catch {
				errors.push(`missing generated artifact: ${rel(path)}`);
				continue;
			}
			if (actual !== serialise(artifact))
				errors.push(
					`generated artifact is stale: ${rel(path)} (run pnpm surface-governance:write)`,
				);
		}
	}

	console.log(
		JSON.stringify(
			{
				mode,
				packages: packages.length,
				exports: packages.reduce((n, p) => n + p.exports.length, 0),
				binaries: packages.reduce((n, p) => n + p.binaries.length, 0),
				roleActions: roles.reduce(
					(n, r) => n + r.openApiOperationIds.length,
					0,
				),
				extensionMessages: messageTypes.length,
				applicationOperations: applicationOperations.length,
				uiControls: staticButtons.length + dynamicControls.length,
				errors: errors.length,
			},
			null,
			2,
		),
	);
	if (errors.length) {
		for (const error of errors) console.error(`SURFACE_GOVERNANCE: ${error}`);
		process.exitCode = 1;
	}
}
await main();

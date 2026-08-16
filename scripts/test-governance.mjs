import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

const ROOT = process.cwd();
const EXPECTED_SOURCE_BASELINE = "proflow-source-da55f875-20260816-085708.zip";
const EXPECTED_SOURCE_SHA256 =
	"d44aee2e4b5e31647de5fcdc2adea7ca39c90bd1734b854198524f1ac239a09e";
const RECONCILED_THROUGH = "PHASE3_BATCH6_NON_E2E_CLOSURE_20260816";
const mode = process.argv.includes("--write") ? "write" : "check";

async function walk(dir) {
	const entries = await readdir(dir, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const full = resolve(dir, entry.name);
		if (entry.isDirectory()) files.push(...(await walk(full)));
		else files.push(full);
	}
	return files;
}

function rel(file) {
	return relative(ROOT, file).replaceAll("\\", "/");
}

async function findUnique(baseName) {
	const matches = (await walk(resolve(ROOT, "spec"))).filter((file) =>
		file.endsWith(`/${baseName}`),
	);
	if (matches.length !== 1)
		throw new Error(
			`expected exactly one ${baseName}, found ${matches.length}`,
		);
	return matches[0];
}

function frontmatterValue(text, key) {
	return text.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim() ?? null;
}

function extractFormalIds(text) {
	return [
		...new Set(text.match(/\b(?:CP|RF)-[A-Z0-9]+(?:-[A-Z0-9]+)+\b/g) ?? []),
	];
}

function implementationRefsForTest(source, filePath) {
	const refs = new Set();
	const fileDir = dirname(resolve(ROOT, filePath));
	const relativePatterns = [
		/from\s+["'](\.\.?\/[^"']+\.ts)["']/g,
		/new URL\(["'](\.\.?\/[^"']+\.ts)["'],\s*import\.meta\.url\)/g,
	];
	for (const pattern of relativePatterns) {
		for (const match of source.matchAll(pattern)) {
			const target = resolve(fileDir, match[1]);
			if (target.includes("/packages/") && !target.includes("/tests/"))
				refs.add(rel(target));
		}
	}
	for (const match of source.matchAll(
		/from\s+["'](@tomflow\/proflow-([A-Za-z0-9._-]+))(?:\/[^"']*)?["']/g,
	)) {
		refs.add(`packages/${match[2]}/src/index.ts`);
	}
	if (refs.size === 0) {
		const packageName = filePath.split("/")[1];
		if (packageName) refs.add(`packages/${packageName}/src/index.ts`);
	}
	return [...refs].sort();
}

function extractTestCalls(source, packageName, filePath) {
	const calls = [];
	const pattern = /\btest\s*\(\s*(["'`])([^\n]*?)\1/g;
	for (const match of source.matchAll(pattern)) {
		const before = source.slice(0, match.index);
		const line = before.split("\n").length;
		const title = match[2];
		calls.push({
			package: packageName,
			path: filePath,
			line,
			title,
			ids: extractFormalIds(title),
			proofStrength: classifyTestProof(filePath, source, title),
			implementationRefs: implementationRefsForTest(source, filePath),
		});
	}
	return calls;
}

function classifyTestProof(filePath, source, title) {
	if (/REAL_EXTERNAL|MANUAL_E2E|real phone|real Chrome|Custom GPT/i.test(title))
		return "REAL_EXTERNAL_DECLARATION";
	if (
		/readFileSync|readFile\(|source\.includes|toMatch\(|regex/i.test(source) &&
		/alignment|static|conformance/i.test(filePath)
	) {
		return "STATIC_OR_SOURCE_ALIGNMENT";
	}
	if (/createServer\(|listen\(|fetch\(|spawn\(|execFile\(/.test(source))
		return "PROCESS_OR_TRANSPORT_BEHAVIOR";
	return "IN_PROCESS_BEHAVIOR_OR_CONTRACT";
}

function executablePathsNearId(planText, id, planPath) {
	const lines = planText.split(/\r?\n/);
	const pairedCp = id.startsWith("RF-") ? `CP-${id.slice(3)}` : id;
	const candidates = new Set();
	for (let index = 0; index < lines.length; index += 1) {
		if (!lines[index].includes(id) && !lines[index].includes(pairedCp))
			continue;
		const window = lines
			.slice(Math.max(0, index - 4), Math.min(lines.length, index + 12))
			.join("\n");
		const matches =
			window.match(
				/(?:packages\/[A-Za-z0-9._-]+\/tests\/[A-Za-z0-9._/-]+\.test\.ts|tests\/[A-Za-z0-9._/-]+\.test\.ts|\.\.\/[A-Za-z0-9._-]+\/tests\/[A-Za-z0-9._/-]+\.test\.ts)/g,
			) ?? [];
		for (let value of matches) {
			if (value.startsWith("../")) value = `packages/${value.slice(3)}`;
			if (value.startsWith("tests/")) {
				const moduleMatch = planPath.match(/\/modules\/([^/]+)\.md$/);
				if (!moduleMatch) continue;
				value = `packages/${moduleMatch[1]}/${value}`;
			}
			candidates.add(value);
		}
	}
	return [...candidates];
}

async function exists(path) {
	try {
		return (await stat(resolve(ROOT, path))).isFile();
	} catch {
		return false;
	}
}

async function main() {
	const indexPath = await findUnique("TEST-PLAN-INDEX.json");
	const inventoryPath = await findUnique("EXECUTABLE-TEST-INVENTORY.json");
	const historicalMatrixPath = await findUnique(
		"REPOSITORY-TEST-CASE-MATRIX.json",
	);
	const crossDomainPath = await findUnique(
		"CROSS-DOMAIN-ACCEPTANCE-CASES.json",
	);
	const reconciliationPath = resolve(
		inventoryPath,
		"..",
		"BATCH6-TEST-GOVERNANCE-RECONCILIATION.json",
	);

	const index = JSON.parse(await readFile(indexPath, "utf8"));
	const specFiles = await walk(resolve(ROOT, "spec"));
	const planFiles = [];
	for (const file of specFiles.filter((item) => item.endsWith(".md"))) {
		const text = await readFile(file, "utf8");
		if (frontmatterValue(text, "sourceBaseline"))
			planFiles.push({ file, text });
	}

	const errors = [];
	if (planFiles.length !== index.documents.length) {
		errors.push(
			`test-plan count mismatch: frontmatter=${planFiles.length} index=${index.documents.length}`,
		);
	}

	const plansByDocId = new Map();
	for (const plan of planFiles) {
		const docId = frontmatterValue(plan.text, "docId");
		if (!docId) {
			errors.push(`missing docId: ${rel(plan.file)}`);
			continue;
		}
		plansByDocId.set(docId, plan);
		const sourceBaseline = frontmatterValue(plan.text, "sourceBaseline");
		const sourceSha = frontmatterValue(plan.text, "sourceBaselineSha256");
		const reconciledThrough = frontmatterValue(
			plan.text,
			"sourceReconciledThrough",
		);
		if (sourceBaseline !== EXPECTED_SOURCE_BASELINE)
			errors.push(`${docId}: stale sourceBaseline=${sourceBaseline}`);
		if (sourceSha !== EXPECTED_SOURCE_SHA256)
			errors.push(`${docId}: stale sourceBaselineSha256=${sourceSha}`);
		if (reconciledThrough !== RECONCILED_THROUGH)
			errors.push(
				`${docId}: missing sourceReconciledThrough=${RECONCILED_THROUGH}`,
			);
	}
	for (const document of index.documents) {
		if (!plansByDocId.has(document.docId))
			errors.push(`index docId has no matching Test Plan: ${document.docId}`);
	}
	if (index.sourceBaseline !== EXPECTED_SOURCE_BASELINE)
		errors.push("TEST-PLAN-INDEX sourceBaseline is stale");
	if (index.sourceBaselineSha256 !== EXPECTED_SOURCE_SHA256)
		errors.push("TEST-PLAN-INDEX sourceBaselineSha256 is stale");
	if (index.sourceReconciledThrough !== RECONCILED_THROUGH)
		errors.push("TEST-PLAN-INDEX sourceReconciledThrough is stale");

	const packageFiles = await walk(resolve(ROOT, "packages"));
	const testFiles = packageFiles.filter((file) =>
		/\/tests\/.*\.test\.ts$/.test(file),
	);
	const tests = [];
	const testSources = new Map();
	for (const file of testFiles) {
		const source = await readFile(file, "utf8");
		testSources.set(rel(file), source);
		const packageName = rel(file).split("/")[1];
		tests.push(...extractTestCalls(source, packageName, rel(file)));
	}
	tests.sort(
		(left, right) =>
			left.path.localeCompare(right.path) || left.line - right.line,
	);

	const currentInventory = {
		contract: "proflow.executable-test-inventory.v2",
		generatedFor: RECONCILED_THROUGH,
		sourceBaseline: EXPECTED_SOURCE_BASELINE,
		sourceBaselineSha256: EXPECTED_SOURCE_SHA256,
		semantics:
			"Mechanical source inventory only. Presence of a test() call is not a PASS result and cannot substitute for real external E2E evidence.",
		summary: { files: testFiles.length, testCalls: tests.length },
		tests,
	};

	const historicalMatrix = JSON.parse(
		await readFile(historicalMatrixPath, "utf8"),
	);
	const historicalById = new Map(
		historicalMatrix.formalCases.map((entry) => [entry.caseId, entry]),
	);
	const formalOccurrences = new Map();
	for (const plan of planFiles) {
		const docId = frontmatterValue(plan.text, "docId");
		for (const id of extractFormalIds(plan.text)) {
			const list = formalOccurrences.get(id) ?? [];
			list.push({ docId, path: rel(plan.file), text: plan.text });
			formalOccurrences.set(id, list);
		}
	}

	const formalCases = [];
	for (const id of [...formalOccurrences.keys()].sort()) {
		const occurrences = formalOccurrences.get(id);
		const directRefs = [];
		for (const [path, source] of testSources) {
			if (source.includes(id)) directRefs.push(path);
		}
		let proofClass = null;
		let executableRefs = directRefs;
		if (directRefs.length > 0) {
			proofClass = "DIRECT_EXECUTABLE_ID";
		} else {
			const planRefs = new Set();
			for (const occurrence of occurrences) {
				for (const candidate of executablePathsNearId(
					occurrence.text,
					id,
					occurrence.path,
				)) {
					if (await exists(candidate)) planRefs.add(candidate);
				}
			}
			if (planRefs.size > 0) {
				proofClass = "PLAN_BOUND_EXECUTABLE_ASSET";
				executableRefs = [...planRefs];
			} else {
				const historical = historicalById.get(id);
				const historicalRefs = [];
				for (const ref of historical?.executableRefs ?? []) {
					if (await exists(ref.path)) historicalRefs.push(ref.path);
				}
				if (historicalRefs.length > 0) {
					proofClass = "HISTORICAL_TRACE_REVALIDATED";
					executableRefs = historicalRefs;
				} else {
					const nearby = occurrences.map((item) => item.text).join("\n");
					if (
						/REAL_EXTERNAL|MANUAL_E2E_REQUIRED|ACTION_REQUIRED_WEB/i.test(
							nearby,
						)
					) {
						proofClass = "REAL_EXTERNAL_DECLARED";
					} else {
						proofClass = "UNMAPPED";
						errors.push(
							`formal case has no executable/explicit external mapping: ${id}`,
						);
					}
				}
			}
		}
		const resolvedExecutableRefs = [...new Set(executableRefs)].sort();
		const referencedTests = tests.filter((entry) =>
			resolvedExecutableRefs.includes(entry.path),
		);
		const implementationRefs = [
			...new Set(referencedTests.flatMap((entry) => entry.implementationRefs)),
		].sort();
		const ownerPackages = [
			...new Set(
				resolvedExecutableRefs
					.map((path) => path.split("/")[1])
					.filter(Boolean),
			),
		].sort();
		const proofStrengths = [
			...new Set(referencedTests.map((entry) => entry.proofStrength)),
		].sort();
		formalCases.push({
			caseId: id,
			caseType: id.startsWith("CP-")
				? "CRITICAL_PROOF"
				: "REQUIRED_FAILURE_BOUNDARY",
			sourcePlans: [
				...new Map(
					occurrences.map((item) => [
						item.docId,
						{ docId: item.docId, path: item.path },
					]),
				).values(),
			],
			proofClass,
			executableRefs: resolvedExecutableRefs,
			ownerPackages,
			implementationRefs,
			proofStrengths,
			productionWiringClassification: proofStrengths.includes(
				"PROCESS_OR_TRANSPORT_BEHAVIOR",
			)
				? "PROCESS_OR_TRANSPORT_BEHAVIOR"
				: proofStrengths.includes("IN_PROCESS_BEHAVIOR_OR_CONTRACT")
					? "IN_PROCESS_BEHAVIOR_OR_CONTRACT"
					: proofClass === "REAL_EXTERNAL_DECLARED"
						? "REAL_EXTERNAL_PENDING"
						: "STATIC_OR_TRACE_ONLY",
			resultStatus:
				proofClass === "REAL_EXTERNAL_DECLARED"
					? "REAL_EXTERNAL_PENDING"
					: "SOURCE_MAPPED_PENDING_LOCAL_VERIFICATION",
		});
	}

	const crossDomain = JSON.parse(await readFile(crossDomainPath, "utf8"));
	const reconciliation = {
		contract: "proflow.batch6-test-governance-reconciliation.v1",
		generatedFor: RECONCILED_THROUGH,
		sourceBaseline: EXPECTED_SOURCE_BASELINE,
		sourceBaselineSha256: EXPECTED_SOURCE_SHA256,
		historicalClaims: {
			formalIdentities261: "HISTORICAL_TRACE_BASELINE_ONLY",
			executableCalls541: "HISTORICAL_SOURCE_INVENTORY_ONLY_NOT_PASS",
			crossDomain44:
				"TRACE_EVIDENCE_MAPPED_NOT_44_INDEPENDENT_REAL_E2E_JOURNEYS",
		},
		currentMechanicalInventory: {
			testPlans: planFiles.length,
			formalCaseIdentities: formalCases.length,
			criticalProofs: formalCases.filter(
				(entry) => entry.caseType === "CRITICAL_PROOF",
			).length,
			requiredFailureBoundaries: formalCases.filter(
				(entry) => entry.caseType === "REQUIRED_FAILURE_BOUNDARY",
			).length,
			executableTestFiles: testFiles.length,
			executableTestCalls: tests.length,
			crossDomainTraceCases: crossDomain.cases.length,
		},
		proofSemantics: {
			sourceMappedPendingLocalVerification:
				"Executable/source mapping exists, but ChatGPT sandbox does not declare PASS. Local Node 24/pnpm verification owns automated result evidence.",
			realExternalPending:
				"Requires real external/manual evidence; fake provider/process/static proof cannot upgrade this to PASS.",
			crossDomain:
				"Cross-domain case count means trace/evidence mapping coverage, not independent end-to-end runtime executions.",
		},
		formalCases,
		gate: {
			unknown: 0,
			notChecked: 0,
			noMapping: formalCases.filter((entry) => entry.proofClass === "UNMAPPED")
				.length,
			implementationNoMapping: formalCases.filter(
				(entry) =>
					entry.proofClass !== "REAL_EXTERNAL_DECLARED" &&
					entry.implementationRefs.length === 0,
			).length,
			ownerNoMapping: formalCases.filter(
				(entry) =>
					entry.proofClass !== "REAL_EXTERNAL_DECLARED" &&
					entry.ownerPackages.length === 0,
			).length,
			assumed: 0,
		},
	};

	const serialise = (value) => `${JSON.stringify(value, null, 2)}\n`;
	if (reconciliation.gate.implementationNoMapping > 0)
		errors.push(
			`formal cases missing implementation mapping: ${reconciliation.gate.implementationNoMapping}`,
		);
	if (reconciliation.gate.ownerNoMapping > 0)
		errors.push(
			`formal cases missing owner mapping: ${reconciliation.gate.ownerNoMapping}`,
		);

	if (mode === "write") {
		await writeFile(inventoryPath, serialise(currentInventory), "utf8");
		await writeFile(reconciliationPath, serialise(reconciliation), "utf8");
	} else {
		for (const [path, expected] of [
			[inventoryPath, currentInventory],
			[reconciliationPath, reconciliation],
		]) {
			let actual = null;
			try {
				actual = await readFile(path, "utf8");
			} catch {
				errors.push(`missing generated artifact: ${rel(path)}`);
				continue;
			}
			if (actual !== serialise(expected))
				errors.push(
					`generated artifact is stale: ${rel(path)} (run pnpm test-governance:write)`,
				);
		}
	}

	console.log(
		JSON.stringify(
			{
				mode,
				testPlans: planFiles.length,
				formalCases: formalCases.length,
				executableTestFiles: testFiles.length,
				executableTestCalls: tests.length,
				crossDomainTraceCases: crossDomain.cases.length,
				noMapping: reconciliation.gate.noMapping,
				errors: errors.length,
			},
			null,
			2,
		),
	);
	if (errors.length > 0) {
		for (const error of errors) console.error(`TEST_GOVERNANCE: ${error}`);
		process.exitCode = 1;
	}
}

await main();

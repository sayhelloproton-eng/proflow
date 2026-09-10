import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { parse } from "yaml";
import { z } from "zod";

const text = z.string().min(1);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const materialSchema = z.object({
	packageName: text,
	version: text,
	displayName: text,
	description: text,
	instructions: text,
	actionSchema: text.max(1_000_000),
	conversationStarters: z.array(text).max(32),
	recommendedModel: text,
	capabilities: z.object({ webSearch: z.boolean(), imageGeneration: z.boolean(), codeInterpreter: z.boolean() }).strict(),
	requirements: z.record(z.string(), z.enum(["required", "optional", "disabled"])),
	knowledgeBundleSha256: digest,
}).strict();
const publishedMaterialSchema = z.object({
	displayName: text,
	description: text,
	instructions: text,
	actionSchema: text.max(1_000_000),
	conversationStarters: z.array(text).max(32),
	recommendedModel: text,
	capabilities: materialSchema.shape.capabilities,
}).strict();
export type RoleCarrierPublishedMaterial = z.infer<typeof publishedMaterialSchema>;
export type RoleCarrierMaterial = z.infer<typeof materialSchema>;
export type RoleCarrierMaterialIssue = "ROLE_CARRIER_MATERIAL_DRIFT" | "ROLE_CARRIER_MATERIAL_UNVERIFIED";

function canonical(value: unknown, depth = 0): string {
	if (depth > 64) throw new Error("ROLE_CARRIER_MATERIAL_INVALID");
	if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
	if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map((item) => canonical(item, depth + 1)).join(",")}]`;
	if (typeof value === "object" && value !== null) {
		const record = value as Record<string, unknown>;
		return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key], depth + 1)}`).join(",")}}`;
	}
	throw new Error("ROLE_CARRIER_MATERIAL_INVALID");
}
const normalize = (value: string) => value.replace(/\r\n?/g, "\n").trim();

function publishedProjection(material: RoleCarrierMaterial): RoleCarrierPublishedMaterial {
	return {
		displayName: material.displayName,
		description: material.description,
		instructions: material.instructions,
		actionSchema: material.actionSchema,
		conversationStarters: material.conversationStarters,
		recommendedModel: material.recommendedModel,
		capabilities: material.capabilities,
	};
}

function roleCarrierPublishedMaterialFingerprint(input: unknown): string {
	const material = publishedMaterialSchema.parse(input);
	const schema: unknown = parse(material.actionSchema);
	if (typeof schema !== "object" || schema === null || Array.isArray(schema))
		throw new Error("ROLE_CARRIER_MATERIAL_INVALID");
	return `sha256:${createHash("sha256").update(canonical({
		contract: "proflow.role-carrier-published-material.v1",
		...material,
		displayName: normalize(material.displayName),
		description: normalize(material.description),
		instructions: normalize(material.instructions),
		conversationStarters: material.conversationStarters.map(normalize),
		actionSchema: schema,
	})).digest("hex")}`;
}

export function roleCarrierMaterialFingerprint(input: unknown): string {
	return roleCarrierPublishedMaterialFingerprint(
		publishedProjection(materialSchema.parse(input)),
	);
}

export async function readExpectedRoleCarrierMaterial(packageRoot: string, gatewayUrl: string): Promise<RoleCarrierMaterial> {
	const root = await realpath(packageRoot);
	const metadata: unknown = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
	const manifest = z.object({ name: text, version: text, description: text, proflowAgent: z.object({
		displayName: text, instructions: text, conversationStarters: z.array(text),
		carrierProfiles: z.object({ "custom-gpt": z.object({
			recommendedModel: text, capabilities: materialSchema.shape.capabilities,
			requirements: materialSchema.shape.requirements, actionSchema: text, knowledgeBundle: text,
		}) }),
	}) }).parse(metadata);
	const profile = manifest.proflowAgent.carrierProfiles["custom-gpt"];
	async function asset(path: string) {
		if (isAbsolute(path)) throw new Error("ROLE_MATERIAL_ASSET_OUTSIDE_PACKAGE");
		const target = await realpath(resolve(root, path));
		const rel = relative(root, target);
		if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("ROLE_MATERIAL_ASSET_OUTSIDE_PACKAGE");
		return readFile(target);
	}
	const gateway = new URL(gatewayUrl);
	if (gateway.protocol !== "https:" || gateway.username || gateway.password || gateway.pathname !== "/" || gateway.search || gateway.hash) throw new Error("GATEWAY_URL_INVALID");
	const [schema, knowledge] = await Promise.all([asset(profile.actionSchema), asset(profile.knowledgeBundle)]);
	return materialSchema.parse({
		packageName: manifest.name, version: manifest.version, description: manifest.description,
		displayName: manifest.proflowAgent.displayName, instructions: manifest.proflowAgent.instructions,
		conversationStarters: manifest.proflowAgent.conversationStarters,
		recommendedModel: profile.recommendedModel, capabilities: profile.capabilities, requirements: profile.requirements,
		actionSchema: schema.toString("utf8").replaceAll("https://GATEWAY_PUBLIC_HOST", gateway.origin),
		knowledgeBundleSha256: `sha256:${createHash("sha256").update(knowledge).digest("hex")}`,
	});
}

const observationSchema = z.object({
	contract: z.literal("proflow.role-carrier-material-observation.v1"),
	source: z.literal("LIVE_CARRIER"),
	roleRef: z.string().regex(/^g-[A-Za-z0-9_-]+$/),
	carrierUrl: z.string().url(),
	observedAt: z.string().datetime(),
	material: publishedMaterialSchema,
}).strict();

/** The Browser owner must supply fresh published material, never draft/local echo. */
export function compareRoleCarrierMaterial(input: {
	expected: RoleCarrierMaterial;
	roleRef: string;
	carrierUrl: string;
	observation: unknown;
	now?: number;
}): { status: "MATCH"; fingerprint: string; observedAt: string } | { status: "FAIL"; issue: RoleCarrierMaterialIssue } {
	const parsed = observationSchema.safeParse(input.observation);
	if (!parsed.success) return { status: "FAIL", issue: "ROLE_CARRIER_MATERIAL_UNVERIFIED" };
	const actual = parsed.data;
	const age = (input.now ?? Date.now()) - Date.parse(actual.observedAt);
	if (age < 0 || age > 60_000) return { status: "FAIL", issue: "ROLE_CARRIER_MATERIAL_UNVERIFIED" };
	if (actual.roleRef !== input.roleRef || actual.carrierUrl !== input.carrierUrl || actual.carrierUrl !== `https://chatgpt.com/g/${actual.roleRef}`) return { status: "FAIL", issue: "ROLE_CARRIER_MATERIAL_DRIFT" };
	try {
		const expected = roleCarrierMaterialFingerprint(input.expected);
		if (expected !== roleCarrierPublishedMaterialFingerprint(actual.material)) return { status: "FAIL", issue: "ROLE_CARRIER_MATERIAL_DRIFT" };
		return { status: "MATCH", fingerprint: expected, observedAt: actual.observedAt };
	} catch {
		return { status: "FAIL", issue: "ROLE_CARRIER_MATERIAL_UNVERIFIED" };
	}
}

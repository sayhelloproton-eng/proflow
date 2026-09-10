export type CustomGptCapability =
	| "webSearch"
	| "imageGeneration"
	| "codeInterpreter";

export type CustomGptKnowledgeFile = {
	name: string;
	mime: string;
	sizeBytes: number;
	sha256: string;
	url: string;
};

export type CustomGptProvisioningRequest = {
	packageName: string;
	version: string;
	displayName: string;
	description: string;
	instructions: string;
	conversationStarters: string[];
	recommendedModel: string;
	capabilities: Record<CustomGptCapability, boolean>;
	knowledgeBundle: string;
	actionSchema: string;
	knowledgeFiles: CustomGptKnowledgeFile[];
	bearerCredential?: string;
};

export interface CustomGptEditorPort {
	setTextField(
		field: "displayName" | "description" | "instructions",
		value: string,
	): Promise<void>;
	replaceConversationStarters(values: readonly string[]): Promise<void>;
	selectRecommendedModel(value: string): Promise<void>;
	setCapability(
		capability: CustomGptCapability,
		enabled: boolean,
	): Promise<void>;
	installActionSchema(value: string): Promise<void>;
	configureBearerAuth(value: string): Promise<void>;
	uploadKnowledge(files: readonly CustomGptKnowledgeFile[]): Promise<void>;
	verifyReady(material: CustomGptProvisioningRequest): Promise<void>;
	createPrivate(): Promise<{ gptId: string; carrierUrl: string }>;
	updateExisting(): Promise<{ gptId: string; carrierUrl: string }>;
}

function record(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new TypeError("PROVISIONING_REQUEST_INVALID");
	return value as Record<string, unknown>;
}

function requiredString(value: unknown): string {
	if (typeof value !== "string" || value.trim().length === 0)
		throw new TypeError("PROVISIONING_REQUEST_INVALID");
	return value;
}

function stringArray(value: unknown): string[] {
	if (
		!Array.isArray(value) ||
		value.length === 0 ||
		!value.every((item) => typeof item === "string" && item.trim().length > 0)
	)
		throw new TypeError("PROVISIONING_REQUEST_INVALID");
	return [...value];
}

function knowledgeFiles(value: unknown): CustomGptKnowledgeFile[] {
	if (!Array.isArray(value) || value.length === 0 || value.length > 64)
		throw new TypeError("PROVISIONING_REQUEST_INVALID");
	return value.map((candidate) => {
		const file = record(candidate);
		const name = requiredString(file.name);
		const mime = requiredString(file.mime);
		const sha256 = requiredString(file.sha256);
		const url = requiredString(file.url);
		const sizeBytes = file.sizeBytes;
		if (
			!Number.isInteger(sizeBytes) ||
			Number(sizeBytes) <= 0 ||
			!/^sha256:[0-9a-f]{64}$/.test(sha256)
		)
			throw new TypeError("PROVISIONING_REQUEST_INVALID");
		let parsed: URL;
		try {
			parsed = new URL(url);
		} catch {
			throw new TypeError("PROVISIONING_REQUEST_INVALID");
		}
		if (
			parsed.protocol !== "http:" ||
			parsed.hostname !== "127.0.0.1" ||
			!parsed.pathname.startsWith("/v1/provisioning/files/") ||
			parsed.username !== "" ||
			parsed.password !== ""
		)
			throw new TypeError("PROVISIONING_REQUEST_INVALID");
		return { name, mime, sizeBytes: Number(sizeBytes), sha256, url };
	});
}

export function parseCustomGptProvisioningRequest(
	input: unknown,
): CustomGptProvisioningRequest {
	const source = record(input);
	const capabilities = record(source.capabilities);
	for (const name of [
		"webSearch",
		"imageGeneration",
		"codeInterpreter",
	] as const)
		if (typeof capabilities[name] !== "boolean")
			throw new TypeError("PROVISIONING_REQUEST_INVALID");
	return {
		packageName: requiredString(source.packageName),
		version: requiredString(source.version),
		displayName: requiredString(source.displayName),
		description: requiredString(source.description),
		instructions: requiredString(source.instructions),
		conversationStarters: stringArray(source.conversationStarters),
		recommendedModel: requiredString(source.recommendedModel),
		capabilities: {
			webSearch: capabilities.webSearch as boolean,
			imageGeneration: capabilities.imageGeneration as boolean,
			codeInterpreter: capabilities.codeInterpreter as boolean,
		},
		knowledgeBundle: requiredString(source.knowledgeBundle),
		actionSchema: requiredString(source.actionSchema),
		knowledgeFiles: knowledgeFiles(source.knowledgeFiles),
		...(source.bearerCredential === undefined
			? {}
			: { bearerCredential: requiredString(source.bearerCredential) }),
	};
}

export function createCustomGptEditorDriver(port: CustomGptEditorPort) {
	const configureDraft = async (material: CustomGptProvisioningRequest) => {
		await port.setTextField("displayName", material.displayName);
		await port.setTextField("description", material.description);
		await port.setTextField("instructions", material.instructions);
		await port.replaceConversationStarters(material.conversationStarters);
		await port.selectRecommendedModel(material.recommendedModel);
		for (const capability of [
			"webSearch",
			"imageGeneration",
			"codeInterpreter",
		] as const)
			await port.setCapability(capability, material.capabilities[capability]);
		await port.installActionSchema(material.actionSchema);
		if (material.bearerCredential)
			await port.configureBearerAuth(material.bearerCredential);
		return {
			status: "DRAFT_CONFIGURED" as const,
			packageName: material.packageName,
			version: material.version,
		};
	};
	return Object.freeze({
		configureDraft,
		async synchronizeExisting(material: CustomGptProvisioningRequest) {
			await configureDraft(material);
			await port.uploadKnowledge(material.knowledgeFiles);
			await port.verifyReady(material);
			const live = await port.updateExisting();
			await port.verifyReady(material);
			return {
				status: "LIVE_UPDATED" as const,
				packageName: material.packageName,
				version: material.version,
				...live,
			};
		},
		async provision(material: CustomGptProvisioningRequest) {
			await configureDraft(material);
			await port.uploadKnowledge(material.knowledgeFiles);
			await port.verifyReady(material);
			const live = await port.createPrivate();
			return {
				status: "LIVE_CREATED" as const,
				packageName: material.packageName,
				version: material.version,
				...live,
			};
		},
	});
}

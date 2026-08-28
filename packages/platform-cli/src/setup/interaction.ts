import {
	autocomplete,
	cancel,
	confirm,
	intro,
	isCancel,
	outro,
	password,
	text,
} from "@clack/prompts";

export type SetupActionRequest = {
	moduleRef: string;
	action: string;
	description: string;
	modelIds?: readonly string[];
};

export interface SetupInteraction {
	begin(): void;
	finish(message: string): void;
	confirmStep?(moduleRef: string): Promise<boolean>;
	collect(
		request: SetupActionRequest,
	): Promise<Record<string, unknown> | undefined>;
}

const stepPrompts: Record<string, string> = {
	"execution-browser-extension":
		"下一步将打开 Chrome，并引导你加载浏览器扩展。按 Enter 继续。",
	"dev-tunnel":
		"下一步将检查远程连接；如需登录，会打开 GitHub 授权。按 Enter 继续。",
	"model-provider-api":
		"下一步配置 OpenAI-compatible 模型服务地址。按 Enter 继续。",
	"model-runtime": "下一步从真实模型列表选择 FAST 与 THINK。按 Enter 继续。",
};

function cancelled(value: unknown): value is symbol {
	if (!isCancel(value)) return false;
	cancel("已取消配置，没有继续执行后续步骤。");
	return true;
}

function privateIpv4(hostname: string): boolean {
	const parts = hostname.split(".").map(Number);
	if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part)))
		return false;
	const [first = -1, second = -1] = parts;
	return (
		first === 10 ||
		first === 127 ||
		(first === 192 && second === 168) ||
		(first === 172 && second >= 16 && second <= 31)
	);
}

export function validateProviderBaseUrl(value: string): string | undefined {
	let url: URL;
	try {
		url = new URL(value.trim());
	} catch {
		return "请输入包含 http:// 或 https:// 的完整 API Base URL。";
	}
	if (url.protocol !== "http:" && url.protocol !== "https:")
		return "只支持 HTTP(S) OpenAI-compatible 服务。";
	if (/\/chat\/completions\/?$/i.test(url.pathname))
		return "请填写服务 Base URL，不要包含 /chat/completions。";
	const local =
		url.hostname === "localhost" ||
		url.hostname.endsWith(".local") ||
		privateIpv4(url.hostname);
	if (!local && url.protocol !== "https:")
		return "公网模型服务必须使用 https://。";
	return undefined;
}

async function providerEndpoint(): Promise<
	Record<string, unknown> | undefined
> {
	const value = await text({
		message: "OpenAI-compatible 服务 Base URL",
		placeholder:
			"例如 https://api.deepseek.com 或 http://192.168.0.108:8080/v1",
		validate: (candidate) =>
			candidate === undefined || candidate.trim().length === 0
				? "API Base URL 不能为空。"
				: validateProviderBaseUrl(candidate),
	});
	if (cancelled(value)) return undefined;
	const providerBaseUrl = String(value).trim().replace(/\/$/, "");
	const approved = await confirm({
		message: `使用 ${providerBaseUrl} 连接整个模型服务？`,
		initialValue: true,
	});
	if (cancelled(approved) || approved !== true) return undefined;
	return { providerBaseUrl };
}

async function providerCredential(): Promise<
	Record<string, unknown> | undefined
> {
	const value = await password({
		message: "模型服务 API Key（输入不会显示）",
		mask: "•",
		validate: (candidate) =>
			candidate === undefined || candidate.trim().length === 0
				? "API Key 不能为空。"
				: undefined,
	});
	if (cancelled(value)) return undefined;
	return { providerCredential: String(value) };
}

async function modelRoles(
	modelIds: readonly string[],
): Promise<Record<string, unknown> | undefined> {
	const options = modelIds.map((id) => ({ value: id, label: id }));
	const fastModel = await autocomplete({
		message: "选择 FAST 模型（快速、低延迟）",
		placeholder: "输入关键字搜索模型",
		options,
	});
	if (cancelled(fastModel)) return undefined;
	const reasonModel = await autocomplete({
		message: "选择 THINK 模型（复杂分析与推理）",
		placeholder: "输入关键字搜索模型",
		options,
	});
	if (cancelled(reasonModel)) return undefined;
	const approved = await confirm({
		message: `确认 FAST=${String(fastModel)}，THINK=${String(reasonModel)}？`,
		initialValue: true,
	});
	if (cancelled(approved) || approved !== true) return undefined;
	return { fastModel: String(fastModel), reasonModel: String(reasonModel) };
}

export function createClackSetupInteraction(): SetupInteraction {
	return {
		begin() {
			intro("ProFlow 配置向导");
		},
		finish(message) {
			outro(message);
		},
		async confirmStep(moduleRef) {
			const message = stepPrompts[moduleRef];
			if (!message) return true;
			const approved = await confirm({ message, initialValue: true });
			return !cancelled(approved) && approved === true;
		},
		async collect(request) {
			if (request.action === "provide-provider-endpoint") {
				return providerEndpoint();
			}
			if (request.action === "provide-provider-credential") {
				return providerCredential();
			}
			if (request.action.startsWith("select-") && request.modelIds?.length) {
				return modelRoles(request.modelIds);
			}
			return undefined;
		},
	};
}

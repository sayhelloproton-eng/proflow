import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const packagesRoot = new URL("../packages/", import.meta.url);
const special = {
	"chatgpt-carrier": [
		"USER",
		"创建或选择并验证 Custom GPT",
		"proflow-chatgpt-carrier setup",
		"proflow-chatgpt-carrier setup --carrier-url <url>",
		"Custom GPT URL",
		"proflow-chatgpt-carrier verify",
	],
	"dev-tunnel": [
		"USER",
		"选择或创建持久 Tunnel",
		"proflow-dev-tunnel setup",
		"proflow-dev-tunnel setup --tunnel-id <id> --public-base-url <url>",
		"Tunnel ID、公开 HTTPS URL",
		"proflow-dev-tunnel verify",
	],
	"model-provider-api": [
		"USER",
		"配置并验证模型服务",
		"proflow-model-provider-api setup",
		"proflow-model-provider-api setup --provider-base-url <url>",
		"模型服务 Base URL",
		"proflow-model-provider-api verify",
	],
	"model-runtime": [
		"USER",
		"选择 FAST 与 REASON 模型",
		"proflow-model-runtime setup",
		"proflow-model-runtime setup --fast-model <id> --reason-model <id>",
		"FAST 模型 ID、REASON 模型 ID",
		"proflow-model-runtime verify",
	],
	"execution-browser-extension": [
		"USER",
		"加载并验证 Chrome 扩展",
		"proflow-execution-browser-extension setup",
		"proflow-execution-browser-extension setup --extension-id <id>",
		"Chrome Extension ID",
		"proflow-execution-browser-extension verify",
	],
	"agent-controller-dev": [
		"USER",
		"创建并注册 Custom GPT Role",
		"proflow-agent-controller-dev setup",
		"proflow-agent-controller-dev setup --carrier-url <url>",
		"Custom GPT URL",
		"proflow-agent-controller-dev verify",
	],
	"agent-product": [
		"USER",
		"创建并注册 Custom GPT Role",
		"proflow-agent-product setup",
		"proflow-agent-product setup --carrier-url <url>",
		"Custom GPT URL",
		"proflow-agent-product verify",
	],
	"agent-test-ops": [
		"USER",
		"创建并注册 Custom GPT Role",
		"proflow-agent-test-ops setup",
		"proflow-agent-test-ops setup --carrier-url <url>",
		"Custom GPT URL",
		"proflow-agent-test-ops verify",
	],
};

for (const moduleRef of await readdir(packagesRoot)) {
	const packagePath = join(packagesRoot.pathname, moduleRef, "package.json");
	let metadata;
	try {
		metadata = JSON.parse(await readFile(packagePath, "utf8"));
	} catch {
		continue;
	}
	if (metadata?.proflow?.module !== true) continue;
	const values = special[moduleRef] ?? [
		"AI",
		"完成模块自动配置",
		`platform setup --module ${moduleRef}`,
		`platform setup --module ${moduleRef}`,
		"none",
		"platform status",
	];
	const [responsible, title, interactive, nonInteractive, inputs, verify] =
		values;
	const stepId = `STEP-${moduleRef.toUpperCase()}-01`;
	const guide = `# ${metadata.name} — Module Setup\n\n## ${stepId} — ${title}\n\nResponsible: ${responsible}\nInteractive executable: \`${interactive}\`\nNon-interactive executable: \`${nonInteractive}\`\nRequired inputs: ${inputs}\nVerify: \`${verify}\`\nSuccess condition: \`${moduleRef}.setupStatus=READY\`.\n`;
	await writeFile(join(packagesRoot.pathname, moduleRef, "SETUP.md"), guide);
}

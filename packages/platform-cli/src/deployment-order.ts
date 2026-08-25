export const FROZEN_DEPLOYMENT_INSTALL_ORDER = [
	"chrome-runtime",
	"execution-browser-extension",
	"agent-controller-dev",
	"agent-product",
	"agent-test-ops",
	"agent-gateway",
	"dev-tunnel",
	"agent-runtime",
	"platform-host",
	"execution-runtime",
	"execution-local",
	"model-provider-api",
	"model-runtime",
	"task-orchestration",
	"task-store-sqlite",
	"task-migration-runner",
	"execution-contracts",
	"model-contracts",
	"module-contract",
	"module-skill",
	"module-template",
	"deployment-conformance",
	"platform-cli",
	"chatgpt-carrier",
] as const;

const installRank = new Map<string, number>(
	FROZEN_DEPLOYMENT_INSTALL_ORDER.map((moduleRef, index) => [moduleRef, index]),
);

export function orderModuleRefsForInstall(
	moduleRefs: readonly string[],
): string[] {
	return [...moduleRefs].sort((left, right) => {
		const leftRank = installRank.get(left);
		const rightRank = installRank.get(right);
		if (leftRank !== undefined && rightRank !== undefined)
			return leftRank - rightRank;
		if (leftRank !== undefined) return -1;
		if (rightRank !== undefined) return 1;
		return left.localeCompare(right);
	});
}

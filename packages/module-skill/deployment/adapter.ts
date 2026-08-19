import { readFile } from "node:fs/promises";

import { descriptor, STOP_RULE_TOKENS } from "../src/index.ts";

async function readSkillPolicy(): Promise<string> {
	for (const relativePath of ["../SKILL.md", "../../SKILL.md"] as const) {
		try {
			return await readFile(new URL(relativePath, import.meta.url), "utf8");
		} catch {
			// Source execution resolves ../SKILL.md; compiled dist resolves ../../SKILL.md.
		}
	}
	return "";
}

function stopRulesPresent(content: string): boolean {
	return (
		content.length > 0 &&
		STOP_RULE_TOKENS.every((token) => content.includes(token))
	);
}

export const behaviorAdapter = {
	status: () => ({
		result: {
			contract: "deployment.result.v1" as const,
			ok: true,
			status: "SUCCEEDED" as const,
			moduleRef: descriptor.moduleRef,
			moduleVersion: descriptor.moduleVersion,
			data: {
				configStatus: "READY" as const,
				runtimeStatus: "UNKNOWN" as const,
			},
		},
		observedEffects: [],
	}),
	verify: async () => {
		const content = await readSkillPolicy();
		const present = stopRulesPresent(content);
		const check = {
			id: "skill-policy-verify",
			status: present ? ("PASS" as const) : ("FAIL" as const),
			message: present
				? "SKILL.md declares frozen-fact-only stop rules"
				: "SKILL.md is missing or does not declare all required stop rules",
		};
		return {
			result: {
				contract: "deployment.result.v1" as const,
				ok: present,
				status: present ? ("SUCCEEDED" as const) : ("FAILED" as const),
				moduleRef: descriptor.moduleRef,
				moduleVersion: descriptor.moduleVersion,
				checks: [check],
				...(present
					? {}
					: {
							error: {
								code: "VERIFY_FAILED" as const,
								message: "SKILL.md stop rules are incomplete",
								retryable: false,
							},
						}),
			},
			observedEffects: [],
		};
	},
};

# ProFlow

ProFlow is a TypeScript-first multi-agent collaboration platform for iterative product development.

This repository is the new ProFlow product repository. It is an independent multi-package repository hosted inside `proton-workspace/repos/proflow/`.

## Engineering baseline

- Node.js `24.19.0`
- pnpm `11.21.0`
- TypeScript `7.0.2`
- ESM only
- Node native TypeScript execution for development/runtime where applicable
- `node:http` for the initial HTTP transport
- `node:test` + `node:assert/strict` for the default test runner/assertions
- `node:sqlite` + raw SQL for SQLite access
- Biome `2.5.6` for lint/format
- No NestJS / Hono / Fastify by default
- No ORM/query builder by default
- Runtime boundary validation uses Zod `4.1.12`

## Repository boundary

- This repository owns ProFlow source and its internal package graph.
- `proton-workspace` owns cross-product workspace orchestration.
- The sibling legacy repository `../ai-agent-platform/` is reference-only and must never override ProFlow's frozen architecture/test-plan truth sources.
- Do not create runtime dependencies on `../ai-agent-platform/`.
- Published ProFlow packages use the personal npm scope `@tomflow/*` and the `proflow-` package prefix.

Examples:

```text
@tomflow/proflow-module-contract
@tomflow/proflow-task-orchestration
@tomflow/proflow-agent-runtime
@tomflow/proflow-execution-runtime
@tomflow/proflow-model-runtime
```

## Package release workflow

ProFlow uses pnpm native workspace release management. While the five domains are still pre-1.0, package releases are capped to patch bumps on the `0.1.x` line. Packages version independently; `workspace:^` remains the internal dependency contract.

```bash
pnpm change
pnpm release:status
pnpm release:version:dry-run
pnpm release:version
pnpm release:sync:check
pnpm release:publish:dry-run
pnpm release:publish
```

Real npm Registry publication uses a Granular Access Token with package write permission and `Bypass 2FA`; do not disable the account's WebAuthn/2FA to automate release. The local token name is `proflow-local-publish`; only its name/policy may be documented, never the token value. Before a real publish, query the exact `package@version` set, publish the Registry-missing versions with one recursive publish command, then perform one exact Registry verification pass. Do not use local tarballs or a workspace `releases/` directory as Registry acceptance evidence.

Canonical release/version rules: `spec/平台架构与公共约定/02-契约/03-版本与兼容性约定.md`.

## Implementation and release gate

The FINAL FROZEN Phase 3 DDD/SDD baseline and FINAL FROZEN pre-development Test Plan are available through the [Frozen truth entrypoint](spec/README.md). This landing used an independently verified directory fallback because the original ZIP artifacts were unavailable; provenance records that their expected SHA values were not reverified.

Phase 3 implementation now exists and remains governed by `Frozen Spec → Frozen Test Plan → RED → GREEN → Evidence`. Historical scoped closure evidence for `@tomflow/proflow-platform-cli@0.1.36` is recorded in [`DEPLOYMENT-CLI-0.1.36-FREEZE-EVIDENCE.json`](spec/部署领域/08-测试用例与验证/DEPLOYMENT-CLI-0.1.36-FREEZE-EVIDENCE.json); it is historical evidence, not the current Registry release line. Current package versions and publication truth must be read from the repository manifests plus exact npm Registry state.

## v1 Task Journey / Carrier / Observer baseline

The current v1 architecture is Task-fact-driven rather than Browser-orchestration-driven. New Task starts in the Extension, binds exactly three long-lived Custom GPT Worker Conversations, and then advances through deterministic Task facts plus a thin Browser Carrier. Custom GPT native File Bridge / Code Interpreter / Web Search / multi-Action behavior are reused instead of reimplemented.

Before implementing Task/Agent/Browser/Model/Deployment integration, read:

- `spec/平台架构与公共约定/01-架构/04-Task-Journey-Carrier与Observer-v1集成基线.md`
- `spec/任务与编排领域/03-流程与数据/05-Task-Observer推进与异常诊断边界.md`
- `spec/智能体运行与协作领域/03-流程与数据/07-Worker-Turn与GPT原生能力使用边界.md`
- `spec/模型与推理领域/03-流程与数据/08-Task-Diagnostic与System-Assessment推理规范.md`

Key invariants: Owner facts beat model/DOM/log guesses; normal Task progression is deterministic; System Observer is a low-priority derived assessment path; real Effects remain Execution-owned; v1 has no frame registry/iframe team workspace/persistent-tab business identity.

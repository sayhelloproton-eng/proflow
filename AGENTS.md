# AGENTS.md

## Workspace Chat → Local Engineering Protocol｜HARD INHERITANCE

`CHAT_LOCAL_ENGINEERING_PROTOCOL=REQUIRED`

在本仓库执行任何本机工程动作前，必须读取并遵循：

`/Users/agent/Desktop/proton-workspace/skills/chat-local-engineering-protocol/SKILL.md`

该共享 Skill 是 **Chat → Local execution mechanics** 的 workspace-level 单一权威源：Engineering Decision、批量上下文/修改、本机真实 test/build/typecheck/lint/benchmark、低频 progress sampling、Failure First、选择性复验与 Git/WIP 保护均不得被仓库内重复规则降级。仓库规则只补充项目语义、领域/安全/Review 约束；更严格的项目规则继续生效。若共享 Skill 不可读，在 mutation / test / build / Git write 前 STOP。当前 Chat 已读取同版本后无需重复读取。

## Repository identity

This repository is the new **ProFlow** platform product repository.

Repository slug: `proflow`

Expected workspace location:

```text
proton-workspace/repos/proflow/
```

Expected sibling legacy reference repository:

```text
proton-workspace/repos/ai-agent-platform/
```

Expected ProFlow workspace instance root:

```text
proton-workspace/.proflow/
```

## Project context isolation

```text
DEFAULT_PROJECT = repos/proflow
CURRENT_IMPLEMENTATION_TRUTH = spec/
LEGACY_DEFAULT_ACCESS = DENY
LEGACY_REFERENCE_ALLOWED only when the current task explicitly says so
```

Do not inherit `../ai-agent-platform/AGENTS.md` or any legacy repository rule.

## Truth order

For ProFlow implementation, use this order of authority:

1. `spec/` as the current implementation specification.
2. Current ProFlow code that has passed the required TDD gates.
3. `../ai-agent-platform/` evidence only after the current task explicitly authorizes legacy reference access.

The legacy repository is never a current contract, architecture, state, package-layout, or directory truth source.

Before implementation, read:

1. `spec/README.md`.
2. `spec/IMPLEMENTATION-BASELINE.md`.
3. `spec/DOCUMENT-INDEX.json`.
4. `spec/MODULE-REGISTRY.json`.
5. `spec/平台架构与公共约定/06-测试计划/TEST-PLAN-INDEX.json`.

## Hard engineering rules

1. TypeScript-first.
2. Public contracts, DTOs, states, errors, and config are strongly typed.
3. External/boundary data starts as `unknown` and must be runtime validated before becoming trusted.
4. Do not use `any`.
5. ESM only.
6. Prefer erasable TypeScript syntax compatible with Node native type stripping.
7. Do not introduce TypeScript runtime-transform syntax as the default design.
8. Development/runtime should not generate `dist/` or `lib/` by default.
9. Add a build/publish layer only when a package actually needs npm runtime publishing.
10. Prefer Node.js built-in capabilities before adding third-party dependencies.
11. Initial HTTP transport is Node native `node:http`.
12. Initial test runner is `node:test`; assertions use `node:assert/strict`.
13. SQLite access uses Node native `node:sqlite`, raw SQL, prepared statements, transactions, and WAL where required by the frozen design.
14. Lint and format use Biome.
15. Do not introduce NestJS, Hono, Fastify, Vitest, Jest, Prisma, Drizzle, Kysely, sqlite3, or better-sqlite3 without a documented real requirement and controlled decision.
16. Runtime validation is required at boundaries; the approved implementation baseline is Zod 4.1.12.
17. Never add a runtime/package dependency on `../ai-agent-platform/`.
18. Do not copy legacy architecture wholesale.
19. Do not silently change frozen DDD/SDD/Test Plan semantics to make implementation easier.
20. Do not copy the legacy package layout or use legacy code to rewrite a Frozen Contract.
21. Do not create runtime, workspace, relative, or link dependencies on the legacy repository.
22. Do not read legacy implementation as default project context.

## TDD implementation gate

Implementation follows:

```text
Frozen rule/contract
→ Test Plan proof/scenario
→ executable test first
→ RED
→ minimum implementation
→ GREEN
→ refactor
```

If implementation evidence disproves a frozen contract/design assumption:

```text
STOP
→ Contract/Design Change
→ update affected SDD/Test Plan
→ regenerate/adjust tests
→ continue
```

Never silently mutate frozen semantics.

## Repository bootstrap scope

The current implementation specification and Test Plan are landed under `spec/`.
Do not start domain/module implementation until a separate task explicitly opens the applicable Wave/TDD gate.

## v1 architecture alignment gate

Before changing Task / Agent / Browser Carrier / Model / Deployment integration, also read the J0→J6 / X1→X7 baseline:

```text
spec/平台架构与公共约定/01-架构/04-Task-Journey-Carrier与Observer-v1集成基线.md
spec/任务与编排领域/03-流程与数据/05-Task-Observer推进与异常诊断边界.md
spec/智能体运行与协作领域/03-流程与数据/07-Worker-Turn与GPT原生能力使用边界.md
spec/模型与推理领域/03-流程与数据/08-Task-Diagnostic与System-Assessment推理规范.md
```

Implementation MUST NOT reintroduce frame registry/frame-role handshake/iframe team topology, Product-GPT New Task dynamic role discovery, per-Action Browser wake/“continue” loops, Browser natural-language Task progression, a second Browser durable effect runtime, Task Observer default model calls, or System Observer business ownership. Existing implementation is not authority to weaken these rules; implementation gaps must be fixed against the current spec.

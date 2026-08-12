# AGENTS.md

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

## Truth order

For Phase 3 implementation, use this order of authority:

1. FINAL FROZEN Phase 3 DDD/SDD baseline.
2. FINAL FROZEN Phase 3 pre-development Test Plan.
3. Current ProFlow code that has passed the required TDD gates.
4. `../ai-agent-platform/` as legacy/reference-only evidence.

The legacy repository is never a current contract, architecture, state, package-layout, or directory truth source.

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
16. Runtime validation is required at boundaries, but no validation library is preselected.
17. Never add a runtime/package dependency on `../ai-agent-platform/`.
18. Do not copy legacy architecture wholesale.
19. Do not silently change frozen DDD/SDD/Test Plan semantics to make implementation easier.

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

Until the frozen architecture and test-plan artifacts are imported into this repository, this repository is in bootstrap state only.

Do not start domain/module implementation from README, memory, or the legacy repository alone.

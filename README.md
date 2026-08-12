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
- Runtime validation library is intentionally not selected until a real boundary requires one

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

## Implementation gate

Do not begin Phase 3 implementation merely because this repository exists.

Before implementation, the FINAL FROZEN Phase 3 DDD/SDD baseline and FINAL FROZEN pre-development Test Plan must be placed into this repository from the authoritative frozen artifacts. Implementation then proceeds TDD-first against those frozen sources.

# ProFlow Spec Migration Report

## Result

```text
STATUS: PASS
SOURCE_SHA256: 6868e877008d54b4a69c98bd37d6e73a5ae5adcb9e208aee326c47a140ca5b34
SOURCE_FILES: 222
SOURCE_MARKDOWN: 215
SOURCE_JSON: 7
TARGET_ROOT: spec/
```

## JSON disposition

### Keep as active machine-readable truth

- `DOCUMENT-INDEX.json`
- `DOCUMENT-METADATA-SCHEMA.json`
- `MODULE-REGISTRY.json`
- `EXTERNAL-RESOURCE-REGISTRY.json`
- `平台架构与公共约定/06-测试计划/TEST-PLAN-INDEX.json`

These are valuable for Codex/Agent navigation, module governance, dependency discovery and TDD planning.

### Do not keep old freeze snapshots as active truth

The source versions of:

- `DOCUMENT-CONFORMANCE.json`
- `RELEASE-MANIFEST.json`

describe the old frozen artifact and their old file hashes/Phase naming become invalid after migration.

They are preserved only under:

```text
spec/provenance/
```

The current ProFlow replacement is:

- `SPEC-MANIFEST.json`
- `SPEC-CONFORMANCE.json`

## Current naming

```text
ProFlow
proflow
.proflow/
@tomflow/proflow-*
```

## Current engineering overrides applied

```text
Node.js 24.19.0
pnpm 11.21.0
TypeScript 7.0.2
ESM only
node:http
node:test + node:assert/strict
node:sqlite + raw SQL
Biome 2.5.6
runtime validation required; concrete library deferred
```

## Important

This migration intentionally turns the former design-phase package into a **current ProFlow implementation specification**.

It is no longer named or organized as “第三阶段 / Phase 3”.

The legacy `ai-agent-platform` repository has no rule or directory inheritance authority over ProFlow.

# ProFlow Implementation Baseline

`spec/` 是 ProFlow 当前唯一实施规范真源。

## 当前工程基线

```text
Product: ProFlow
Repository: proflow
Workspace: proton-workspace
Instance directory: .proflow/
npm packages: @tomflow/proflow-*

Node.js: 24.19.0
pnpm: 11.21.0
TypeScript: 7.0.2
Module system: ESM only

HTTP: node:http
Tests: node:test + node:assert/strict
SQLite: node:sqlite + raw SQL + prepared statements + transaction + WAL
Lint/Format: Biome 2.5.6

Runtime validation:
- external/boundary input starts as unknown
- runtime validation is mandatory
- approved implementation library: Zod 4.1.12
```

## Normative truth 与 implementation evidence

- `DOCUMENT-INDEX.json` / `SPEC-MANIFEST.json` 描述 canonical normative specification，不因实现结果而静默改写。
- `IMPLEMENTATION-EVIDENCE-INDEX.json` 与各领域 `08-测试用例与验证/` 是实现后机器证据索引，不构成第二份规范真源。
- 实现证据若否定规范假设，必须走 Contract/Design Change；不得把证据文件伪装为 normative manifest。

## Legacy boundary

`../ai-agent-platform/` 不是本规范的父级，也没有规则继承权。

除非当前任务显式声明 `LEGACY_REFERENCE_ALLOWED`，ProFlow 实现不得读取旧仓库来决定：

- 目录结构
- package layout
- AGENTS 规则
- Contract
- State
- Runtime topology
- 技术选型

旧仓库只能在显式授权后用于查询历史实验、失败模式与工程证据。

## TDD

```text
Current spec
→ Current test plan
→ executable test first
→ RED
→ minimal GREEN
→ REFACTOR
→ evidence
```

如现实证据要求改变规范：

```text
STOP
→ Contract/Design Change
→ 更新 spec / test plan
→ 重新验证
→ 继续 TDD
```

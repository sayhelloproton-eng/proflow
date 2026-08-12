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
- concrete validation library is not preselected
```

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

# ProFlow Implementation Baseline

`spec/` 是 ProFlow 当前实施规范真源；具体事实继续由各自 canonical Markdown/frontmatter、代码 Contract/schema 与正式 Test Plan owner 持有。

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

## Normative truth、机器导航与 implementation evidence

- 当前 normative Markdown/frontmatter 与 canonical code Contract/schema 拥有正式语义；机器索引不得成为第二业务真源。
- `DOCUMENT-INDEX.json` 是普通规范文档的派生导航；`平台架构与公共约定/06-测试计划/TEST-PLAN-INDEX.json` 是正式 Test Plan 的派生导航。
- `MODULE-REGISTRY.json` / `EXTERNAL-RESOURCE-REGISTRY.json` 是当前 Module / External Resource 机器导航，并受对应规范与代码 owner 约束。
- `IMPLEMENTATION-EVIDENCE-INDEX.json` 与各领域 `08-测试用例与验证/` 只导航实现/验收证据；其中历史 capture 状态不能覆盖 `00-公共上下文/02-当前接力/CURRENT.md` 或当前 Owner reality。
- 迁移期 hash snapshot / migration conformance 只属于迁移验证过程，不作为长期 tracked current baseline；长期保留一个会随正文持续漂移的 hash manifest 会制造第二真源。
- 实现证据若否定规范假设，必须走 Contract/Design Change；不得把 evidence 文件伪装为 normative manifest。

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

## Current v1 Task Journey / Observer architecture baseline

2026-08-14/15 的 Batch4 前架构收敛已经进入当前规范真源。实现 Task / Agent / Browser Carrier / Model / Deployment 交叉能力前，除本文件外必须读取：

```text
PLATFORM-DOC-01-04  J0→J6 / X1→X7 跨域组合与决策权
TASK-DOC-03-05      Task Observer deterministic progression / diagnostic exception
AGENT-DOC-03-07     Worker Turn / GPT Native / File Bridge / Code Interpreter / Web Search
MODEL-DOC-03-08     Task Diagnostic / System Assessment bounded reasoning
```

当前最高层实现不变量：

```text
Owner current fact > deterministic policy/invariant > model assessment > Conversation/DOM/log guess
normal Task progression = deterministic
Task diagnostic REASON = exception-only, no workflow authority
System Observer = lowest-priority derived assessment, no business ownership
internal durable Effect = Execution
GPT local engineering Tools = Extension Effect Gate → execution-local Direct Tool adapters
Task Observer / bounded reconciliation = backend application composed by platform-host
Browser Carrier = page create/restore/wake/observe, not business orchestrator
workerRef/conversationLocator = stable; tab/window/content identity = transient
```

如果当前代码与这些规范冲突，视为 implementation gap；不得为了迁就代码回写弱化规范。

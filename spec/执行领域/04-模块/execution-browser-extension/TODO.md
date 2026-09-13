---
docId: EXECUTION-TODO-EXECUTION-BROWSER-EXTENSION
title: '`execution-browser-extension` TODO'
docType: todo
authority: operational
lifecycle: active
domain: execution
boundedContext: execution
moduleRef: execution-browser-extension
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- EXECUTION-EXECUTION-BROWSER-EXTENSION-TECH-DESIGN
- EXECUTION-DOC-02-01
- EXECUTION-DOC-02-02
---
# `execution-browser-extension` TODO

> 当前实施 backlog 只记录**仍未完成且已由当前 Contract/Design 明确存在**的工作。历史规划项完成、迁移或被架构裁决替代后必须从 current TODO 删除；历史过程由 Git/provenance/audit evidence 保留，不能让过期 READY/PLANNED 项继续冒充待实施事实。

## Current backlog

截至 2026-09-13 Phase 3 / Real-3 审计 Wave 03：**没有已冻结、仍未完成的 execution-browser-extension implementation task。**

已从 current backlog 移除的旧 `EXE-BR-001..008` 规划项分别覆盖 Worker binding、三 Worker CREATE/RESTORE/WAKE、Task Observer、Permission/Attention、multi-action/Collaboration、restart/UNKNOWN recovery、真实 Carrier E2E 与 System Observer。它们已经由当前源码/测试/Real-3 实现，或其 ownership 已迁移：尤其 deterministic Task Observer / lost-trigger reconciliation 已移至 backend application，不能继续列为 Extension implementation task。

## Residual operational note

`d7043fc` 已在本地源码补充 Permission semantic action dispatch observability（`PERMISSION_ACTION`），并按用户裁决暂不单独发包。它属于 release/adoption bookkeeping，不重新创建一个“实现 Permission”的 Module TODO；发布前仍按正常 package gate / adoption / runtime evidence 流程验证。

## New task admission rule

未来新增本 Module TODO 时必须同时给出：

```text
current source/design evidence
明确 owner 与 moduleRef
scope / forbidden boundary
acceptance
verification
依赖状态
```

不得把历史聊天、旧架构任务、已经完成的 Real-3 blocker 或纯 release bookkeeping 重新登记为 implementation backlog；不得通过 TODO 创造新 Domain/Bounded Context/Service/Public Contract。

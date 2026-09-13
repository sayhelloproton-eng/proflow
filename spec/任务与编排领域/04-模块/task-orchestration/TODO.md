---
docId: TASK-ORCHESTRATION-TODO-TASK-ORCHESTRATION
title: '`task-orchestration` TODO'
docType: todo
authority: operational
lifecycle: active
domain: task-orchestration
boundedContext: task-orchestration
moduleRef: task-orchestration
subdomain: null
subdomains:
- task-lifecycle
- task-chain
- node-workflow
- task-documents
- message-event-audit
provides: []
requires: []
contractRefs:
- TASK-ORCHESTRATION-TECH-TASK-ORCHESTRATION
- TASK-DOC-02-01
- TASK-DOC-02-02
---

# `task-orchestration` TODO

> 本文件只保存**当前仍未完成、且已由当前 Contract/Design 明确冻结**的 Module implementation backlog。完成、迁移或被架构裁决替代的历史任务不得继续以 `READY/PLANNED` 冒充待施工事实。

## Current backlog

截至 2026-09-13 Phase 3 / Real-3 全链审计 Wave 09：**没有已冻结、仍未完成的本 Module implementation task。**

Task lifecycle/state/version/idempotency/TaskRoleBinding/TaskDocument/reopen/reconciliation 已有 current implementation 与 executable proof；Wave 08 发现的 downstream reopen generation reuse 也已修复并以真实 SQLite 回归证明。

## Historical task identities

历史任务标识 `TASK-ORCH-001..008` 已从 current backlog 移除。Test Plan 中若仍引用这些 ID，它们只作为历史 traceability/provenance identity，不表示当前存在待实施工作；后续文档治理 Wave 会统一检查 dangling/重复导航。

## Residual validation boundary

真实 Chrome/Custom GPT/外部 Carrier 的持续兼容性、完整 Full Suite、release/adoption/runtime materialization 等属于 Test Plan / Known Limitation / Deployment / Final Gate，不因为尚需最终验证而重新创建 implementation TODO。

## New task admission rule

未来新增 TODO 必须同时具备：

```text
current source/design evidence
明确 owner 与 moduleRef
尚未实现的具体行为缺口
scope / forbidden boundary
acceptance + executable verification path
```

不得把历史聊天、旧 blocker、已完成的 Real-3 defect、纯 release bookkeeping 或最终验收 gate 重新包装为 implementation backlog。

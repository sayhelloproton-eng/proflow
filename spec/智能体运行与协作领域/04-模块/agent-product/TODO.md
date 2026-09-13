---
docId: AGENT-RUNTIME-COLLABORATION-TODO-AGENT-PRODUCT
title: '`agent-product` TODO'
docType: todo
authority: operational
lifecycle: active
domain: agent-runtime-collaboration
boundedContext: agent-runtime-collaboration
moduleRef: agent-product
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- AGENT-RUNTIME-COLLABORATION-TECH-AGENT-PRODUCT
- AGENT-DOC-02-03
---

# `agent-product` TODO

> 本文件只保存**当前仍未完成、且已由当前 Contract/Design 明确冻结**的 Module implementation backlog。完成、迁移或被架构裁决替代的历史任务不得继续以 `READY/PLANNED` 冒充待施工事实。

## Current backlog

截至 2026-09-13 Phase 3 / Real-3 全链审计 Wave 09：**没有已冻结、仍未完成的本 Module implementation task。**

Product fixed Role package、static Actions、PENDING Task Requirement flow、native capability boundary 与真实 Worker identity 主链已进入 current implementation/Real-3 journey。

## Historical task identities

历史任务标识 `AGT-PROD-001..005` 已从 current backlog 移除。Test Plan 中若仍引用这些 ID，它们只作为历史 traceability/provenance identity，不表示当前存在待实施工作；后续文档治理 Wave 会统一检查 dangling/重复导航。

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

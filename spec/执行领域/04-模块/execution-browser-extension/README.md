---
docId: EXECUTION-EXECUTION-BROWSER-EXTENSION-README
title: '`execution-browser-extension`'
docType: module-readme
authority: normative
lifecycle: active
domain: execution
moduleRef: execution-browser-extension
contractRefs:
- EXECUTION-EXECUTION-BROWSER-EXTENSION-TECH-DESIGN
---

# `execution-browser-extension`

Execution-owned Chrome MV3 Carrier and local Effect Gate for Custom GPT runtime integration.

v1 current responsibilities:

```text
Task/New Task UI + Approval/Attention UI
backend Task Observer/Reconciliation 的 Carrier kick/dispatch adapter（不拥有 progression detection）
System Observer（lowest-priority derived assessment application）
Background Carrier Controller
Conversation CREATE/RESTORE/WAKE
c-id/URL/content-session observation
DOM-first input/submit/observe + Permission/other blocker strategy
screenshot → Vision fallback
physical Collaboration delivery
Browser Effect reality recovery/evidence
独立 Local Tool Effect Gate/lane → execution-local
Side Panel / bounded runtime display
```

Task deterministic progression / lost-trigger reconciliation 当前位于 backend application，不在 MV3 Extension 内。Extension 只消费 typed Carrier request，并在物理 dispatch 前复验当前 browser/session/denial reality。System Observer 的 application loop 当前在 Extension，但 owner views/reason 仍经 Platform Host current facts，assessment 只是派生诊断。

Local Tool lane 与 Browser/Carrier hot path 必须隔离 queue/pending/timeout/locks/session state；Repomix / Local Dev / CodeGraph 不进入 `execution-runtime` lifecycle，也不创建 `executionRef`。

It does **not** own Task/Agent business facts, Task progression state, GPT reasoning, ordinary business file truth, or a second durable effect/state runtime. No frame registry/iframe workspace/persistent tab business identity. See the detailed technical design for J1–J6 integration and recovery rules.

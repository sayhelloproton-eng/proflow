---
docId: TASK-ORCHESTRATION-TECH-TASK-ORCHESTRATION
title: '`task-orchestration` Technical Design Index'
docType: module-design-index
authority: normative
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
- TASK-DOC-02-01
- TASK-DOC-02-02
- TASK-DOC-03-05
---

# `task-orchestration` Technical Design Index

## Responsibility

负责 Task/TaskGroup/Node/TaskRoleBinding/TaskDocument 的 Domain/Application Services；不实现 Browser、Tool、Observer daemon 或模型判断。

## Detailed sources

- [00-Service与npm模块设计.md](../00-Service与npm模块设计.md)
- [01-Public-API-契约.md](../../02-契约/01-Public-API-契约.md)
- [01-关键流程与状态转换.md](../../03-流程与数据/01-关键流程与状态转换.md)
- [05-Task-Observer推进与异常诊断边界.md](../../03-流程与数据/05-Task-Observer推进与异常诊断边界.md)

## 2026-09-09 Journey alignment

Module 继续维护 PENDING→READY、TaskRoleBinding、TaskDocument、`getTaskDriveProjection`、Worker `startNode`、reopen same Worker/runNo+1、terminal stop-driving facts。

Task Observer/Reconciliation **不在本 package 也不在 Browser Extension**；它作为 backend application consumer 读取 `getTaskDriveProjection` 与其他 Owner current facts，做 deterministic next-step + bounded catch-up，然后通过正式 Carrier/Owner port 请求动作。所有业务写入仍回 Task commands。

Local Tool result 不自动推进 Node；Worker 自己判断完成后显式调用 `completeNode/waitNode/failNode`。

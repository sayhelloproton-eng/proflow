---
docId: AGENT-RUNTIME-COLLABORATION-TECH-AGENT-RUNTIME
title: '`agent-runtime` Technical Design Index'
docType: module-design-index
authority: normative
lifecycle: active
domain: agent-runtime-collaboration
boundedContext: agent-runtime-collaboration
moduleRef: agent-runtime
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- AGENT-RUNTIME-COLLABORATION-TECH-AGENT-RUNTIME
- AGENT-DOC-02-01
- AGENT-DOC-03-01
- AGENT-DOC-03-03
- AGENT-DOC-03-05
---

# `agent-runtime` Technical Design Index

## Responsibility

platform-host 进程内装配的 Agent Domain runtime，承载 Role Registry、Role credential domain service、Collaboration Message Center 与 Agent Public API。

## Existing detailed sources

- [01-数据存储目录与包模块设计.md](../01-数据存储目录与包模块设计.md)
- [01-Role-Registry与认证.md](../../03-流程与数据/01-Role-Registry与认证.md)
- [03-Collaboration-Message-Center.md](../../03-流程与数据/03-Collaboration-Message-Center.md)
- [01-失败恢复版本安全与验收.md](../../05-质量与部署/01-失败恢复版本安全与验收.md)

## Boundary Rule

本文件只定义该 Module 的工程落点，不复制 Domain / Bounded Context 的 canonical facts。若实现需要引入当前 normative Contract 未定义的新算法语义、状态、持久化事实或跨域 Contract，必须先完成对应设计与 Contract Change；不得由 TODO/Codex 自行补全。

## 2026-08-14 Fixed Role / Collaboration Alignment

v1 Role Registry只服务本地management/Deployment/Carrier lookup；New Task不做动态Role discovery。Task是`agentPackageRef→roleRef/workerRef/conversationLocator` binding owner，Agent Runtime只校验authenticated role/worker context，不复制Task binding。Collaboration Message Center拥有askPeer/replyPeer durable facts，但不创建Task Node/WAIT/transition；physical delivery由Extension Carrier请求路径完成。Agent Runtime不保存tab/frame，也不实现Task/System Observer scheduler。

## 审计补充：消除 Agent 的间接启动环

目标 descriptor 还必须删除 `agent-runtime.requires: execution`；保留 `task-orchestration`。真实 Agent adapter 只创建 Role store，start/stop 为 library no-op；逻辑 Collaboration 接收 delivery evidence，不要求 Execution 服务参与初始化。ExecutionRef 作为消息投递证据字段不构成启动依赖。

否则新增 Execution → Extension 后会形成 `execution-runtime → execution-browser-extension → agent-runtime → execution-runtime` 环，也会让 Host/Task/Peer 间接依赖 Execution。Delivery 的请求期 durable Execution 依赖仍保留在 Carrier/composition，不删除消息 Evidence 语义。全量演算必须包含 Agent descriptor，不能只验证三个修改模块的子图。

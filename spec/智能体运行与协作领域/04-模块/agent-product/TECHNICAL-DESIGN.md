---
docId: AGENT-RUNTIME-COLLABORATION-TECH-AGENT-PRODUCT
title: '`agent-product` Technical Design Index'
docType: module-design-index
authority: normative
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

# `agent-product` Technical Design Index

## Responsibility

产品 Role Agent Package；包含 Custom GPT 创建材料、Instructions、static Actions/capability requirements 与 role registration 管理。Knowledge specialization 为 future/deferred，不是 v1 创建/READY 前置。

## Existing detailed sources

- [00-Agent-Package与Custom-GPT-Carrier规范.md](../00-Agent-Package与Custom-GPT-Carrier规范.md)
- [06-产品前置工作流与Carrier身份.md](../../03-流程与数据/06-产品前置工作流与Carrier身份.md)
- [03-角色Action静态权限矩阵.md](../../02-契约/03-角色Action静态权限矩阵.md)

## Boundary Rule

本文件只定义该 Module 的工程落点，不复制 Domain / Bounded Context 的 canonical facts。若实现需要引入当前 normative Contract 未定义的新算法语义、状态、持久化事实或跨域 Contract，必须先完成对应设计与 Contract Change；不得由 TODO/Codex 自行补全。

## 2026-08-14 v1 integration boundary

### New Task / Worker lifecycle

`agent-product` does **not** create the Task or dynamically discover the team. The Extension/application flow creates `Task(PENDING)`, resolves the fixed Product package to its registered `roleRef`, creates/observes a fresh Product Conversation, and binds `workerRef + conversationLocator`. Product may start requirement discussion as soon as its own binding is durable while Dev/Test bindings continue independently.

### Role package scope

The package defines the generic Product role, Instructions and static business-purpose Action surface. v1 does not add Product subtypes, Persona service, dynamic capability matching or permanent Role Knowledge specialization. Future Knowledge may specialize the generic role but is outside this batch.

### GPT-native capability boundary

Within a Worker Turn:

```text
need public knowledge              → Web Search
need temporary file/data analysis  → Code Interpreter / Conversation files
need Conversation↔platform files   → File Bridge
need formal ProFlow fact/write      → GPT Action → owner domain
need another Worker                 → Collaboration
need real machine/external effect   → Execution
```

Product must not use Browser DOM as a file manager, inject large Task context through the page, infer formal Task state from chat text, or request a per-Action Browser “continue” loop. `createTask/listRegisteredRoles/getRegisteredRole` are not part of the Product GPT New Task main Action surface.

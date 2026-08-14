---
docId: PLATFORM-HOST-INDEX
title: '`platform-host` Module'
docType: module-index
authority: normative
lifecycle: active
domain: platform
moduleRef: platform-host
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- PLATFORM-HOST-TECH-DESIGN
- PLATFORM-HOST-COMPOSITION-ROOT
---

# `platform-host` Module

## Identity

```text
moduleRef: platform-host
package: @tomflow/proflow-platform-host
kind: application-composition-root
service/process: platform-host / platform-host-process
```

## Purpose

`platform-host` 是本地 Application Composition Root：装配 Task/Agent packages，注入 Execution/Model public clients，提供 local transport、startup/shutdown 与轻量 dependency health aggregation。

它**不是第六领域，也不是 Extension Observer/Carrier runtime**。

## Boundary

- 不拥有任何 Domain business fact。
- 不保存 Task/Agent/Execution/Model/Deployment 的第二份状态。
- 不保存 Task Observer progression truth 或 System Observer assessment business truth。
- 不持久化 Browser `tabId`/Conversation page state。
- Domain package 不得反向依赖 platform-host。
- 只有已有 Public Contract 的独立 package/client 才能被装配。

## Extension Relationship

Extension 独立承载：

```text
Task UI
Approval / Alert UI
Task Observer
System Observer
Background Carrier Controller
```

platform-host 只通过正式 public transports/clients 向这些 application consumers 提供 owner facts/capabilities；不把 Observer 逻辑搬进 host。

## Documents

- [TECHNICAL-DESIGN.md](TECHNICAL-DESIGN.md)
- [SERVICE-RUNTIME.md](SERVICE-RUNTIME.md)
- [TODO.md](TODO.md)
- 跨域 Journey：[`PLATFORM-DOC-01-04`](../../01-架构/04-Task-Journey-Carrier与Observer-v1集成基线.md)

---
docId: PLATFORM-HOST-TECH-DESIGN
title: '`platform-host` Technical Design'
docType: module-design
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

# `platform-host` Technical Design

## 1. Composition

```text
platform-host
├─ @tomflow/proflow-task-orchestration
├─ @tomflow/proflow-agent-runtime
├─ Execution public client/contracts
├─ Model public client/contracts
└─ local public transport/router
```

Extension、Agent Gateway、Execution Runtime、Model Runtime 仍是独立运行/部署单元。

## 2. Responsibilities

1. 创建 composition root 与 DI graph。
2. 建立 local transport/router，把请求转交事实 Owner。
3. 按依赖顺序启动/停止 host-owned runtime components。
4. 聚合 process/transport/dependency liveness/readiness，不发明 Domain READY。
5. 消费 platform-host 自己拥有的 runtime state/config 与明确 Public Contract/shared facts；Platform CLI 不注入、不解释其私有配置。
6. 为 Extension application consumers 提供 Task/Agent/Execution/Model public client path。

## 3. Observer Support，但不拥有 Observer

Task Observer/System Observer 的物理 application logic 位于 Extension background。host 只允许提供：

```text
Task drive projection/query
Agent/Collaboration public query
Execution result/approval/public query
Model infer/status client
bounded dependency health projection
```

System Observer 的 batching/carry-forward/global synthesis orchestration 不进入 platform-host Domain state；Task Observer 也不能由 host 定时器绕过 Extension/Carrier 直接推进 Task。

## 4. Forbidden

- Task/Agent business Repository。
- Execution Effect implementation。
- Model provider/ReasoningSpec owner implementation。
- Deployment / Platform CLI 私有 config、setup/status 或 Module lifecycle 第二真源。
- cross-domain mutable mirror/global cache。
- universal scheduler/event bus。
- Browser DOM operation/frame/tab registry。
- assessment → direct business mutation。

## 5. Failure Isolation

某依赖 unavailable 时，host 返回 typed dependency状态；不得篡改该领域业务状态。restart 后重建 graph 并重新查询 Owner current reality，不 replay mutation。

## 6. Decision Authority

host 只做 transport/composition。Owner current fact/hard rule > deterministic > FAST > REASON > Human 的横切决策层级由各正式组件执行；host 本身不是 Policy/Planner。

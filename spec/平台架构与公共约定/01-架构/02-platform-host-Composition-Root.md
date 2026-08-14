---
docId: PLATFORM-HOST-COMPOSITION-ROOT
title: '`@tomflow/proflow-platform-host` Application Composition Root'
docType: module-design
authority: normative
lifecycle: active
domain: platform
moduleRef: platform-host
canonicalFor:
- platform-host.boundary
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- PLATFORM-HOST-TECH-DESIGN
- PLATFORM-HOST-COMPOSITION-ROOT
---

# `@tomflow/proflow-platform-host` Application Composition Root

## 1. Boundary

`platform-host` 是独立 npm package，但不是第六业务领域。它只负责：

```text
instantiate
Dependency Injection
local public transport/router
startup / shutdown
public client wiring
light health aggregation
```

禁止拥有：

```text
Task workflow facts
Role/Worker/Collaboration facts
Execution Effect/Result/Evidence/Approval
Model inference/assessment business facts
Deployment Plan/Manifest truth
Browser tab/Conversation runtime state
Task/System Observer durable truth
```

## 2. Runtime Relationship

```text
Custom GPT
   ↓ Actions
agent-gateway
   ↓ local public transport
platform-host
   ├─ task-orchestration package
   ├─ agent-runtime package
   ├─ execution-runtime public client
   └─ model-runtime public client

Extension (separate install/runtime)
   ├─ Task UI / Approval-Alert UI
   ├─ Task Observer
   ├─ System Observer
   └─ Background Carrier Controller
        ↓
     owner public transports / execution-browser-extension
```

> 注：上图 `agent-gateway` 为正式名称；若渲染工具不处理等宽箭头，语义仍以本文为准。

Execution Runtime、Model Runtime、Agent Gateway 是独立 service/process/deployment unit；Browser Extension 独立安装。platform-host 不把它们折成一个新 Monolith Domain。

## 3. Observer Composition Boundary

Task Observer 与 System Observer 的行为逻辑在 Extension application/background。platform-host 可以提供：

```text
Task drive projection client
Agent/Collaboration query client
Execution result/approval query client
Model infer/health client
Deployment/health projection client（若通过正式 public transport 暴露）
```

但 host 不能：

```text
决定 Task 下一步
持久化 assessment as business truth
直接 approve/reopen/complete
替 Browser 操作网页
```

## 4. Health

host 只聚合：

```text
process alive
local transport healthy
dependency availability
```

不得发明各 Domain READY。System Observer 若消费 host/dependency health，也只把其作为 bounded input。

## 5. Recovery

host restart：

```text
rebuild composition graph
→ re-open public clients
→ query owner current reality
```

不从 host cache/log 恢复业务事实，不 replay mutation。

## 6. TODO Discipline

Composition/wiring 只能在 Provider Public Contract 冻结后实施。host tests 证明 wiring/startup/shutdown/transport/health isolation，不替代领域行为、Browser Carrier 或 Observer assessment tests。

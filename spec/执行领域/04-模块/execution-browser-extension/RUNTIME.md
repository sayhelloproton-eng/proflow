---
docId: EXECUTION-EXECUTION-BROWSER-EXTENSION-RUNTIME
title: '`execution-browser-extension` Runtime'
docType: runtime-design
authority: normative
lifecycle: active
domain: execution
moduleRef: execution-browser-extension
contractRefs:
- EXECUTION-EXECUTION-BROWSER-EXTENSION-TECH-DESIGN
- PLATFORM-DOC-01-04
---

# `execution-browser-extension` Runtime

## Runtime surfaces

同一个 MV3 Extension package 内逻辑分层：

```text
Task UI / Approval-Alert UI
Task Observer
System Observer
Background Carrier Controller
Content Script / screenshot adapter
Side Panel
```

这不是多个新 Domain/Service。

## Identity

Stable：

```text
agentPackageRef
roleRef
workerRef
conversationLocator
```

Transient：

```text
tabId/windowId
extensionInstanceId/contentInstanceId
attemptNo
```

Extension 重启只重建 transient binding；不得生成新的 Task Worker identity。

## Task Observer runtime

读取 bounded Task drive projection + relevant Owner readiness，确定性地请求 WAKE/RESUME。正常 progression 不调用模型；单 Task异常诊断才可低频请求 REASON。

## System Observer runtime

最低优先级读取跨域 bounded snapshots，通过 Model Runtime执行分批/carry-forward/drill-down/global synthesis。模型 busy 或业务 active 时 defer；assessment不改变 Owner truth。

## Carrier Controller runtime

所有页面写操作从 typed command 进入，按 current page identity/fresh content session执行 DOM-first open/restore/input/submit/observe。无 frame registry/coordinate automation。

## Serialization

同 Worker页面写串行；Browser real effects使用 durable Execution semantics。一个 Worker Turn可以连续多 Action，因此不锁定“Action结束→Browser再WAKE”的节奏。

## Reload / Disconnect

```text
reconnect
→ discover page reality
→ reconcile unfinished durable Browser effects
→ reuse existing Conversation
→ no blind CREATE/WAKE replay
```

Effect reality 不确定时保持 UNKNOWN。

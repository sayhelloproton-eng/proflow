---
docId: TASK-DOC-03-05
title: 任务与编排领域｜Task Observer 推进投影与异常诊断边界
docType: cross-domain-flow
authority: normative
lifecycle: active
domain: task-orchestration
boundedContext: task-orchestration
subdomain: null
subdomains:
- task-lifecycle
- node-workflow
provides: []
requires: []
contractRefs:
- PLATFORM-DOC-01-04
---

# 任务与编排领域｜Task Observer 推进投影与异常诊断边界

> Task Observer 的物理实现位于 Extension application/background 侧；本文只冻结 Task Domain 为 Observer 提供什么正式事实，以及 Observer 不得把什么推回 Task。

## 1. Task Observer 不是 Task Owner

Task Observer 只做：

```text
READ current owner facts
→ DETECT deterministic next-step condition
→ REQUEST typed carrier/application action
```

它不得直接修改 Task/Node，不得绕过 `startTask/startNode/completeNode/waitNode/reopenNode` 等正式命令。

## 2. Task 应提供的 drive projection

Task Query 至少能够让调用方稳定得到：

```text
taskId / task status / task version
currentNodeId
nodeId / node status / node version / runNo
requiredAgentPackageRef
TaskRoleBinding(agentPackageRef, roleRef, workerRef, conversationLocator)
terminal flag
reopen context（如有）
```

Task 不把 Execution/Collaboration/Carrier 的状态复制进自身 Store；Observer 对这些 Owner 分别读取 public facts。

## 3. 确定性触发

典型条件：

```text
Node READY                 → request WAKE correct Worker
Execution Result READY      → request RESUME same Worker
Peer Reply READY            → request RESUME same Worker
Reopen target READY         → request WAKE same Worker/runNo+1
wake/recovery unfinished    → request bounded carrier reconciliation
Task terminal               → STOP driving
```

具体 typed command 名称可由 Extension/Execution contract 冻结；Task Domain 不拥有 Browser command vocabulary。

## 4. READY 与 startNode

Task Observer 看到 Node READY 后先恢复/WAKE Worker，不替 Worker 调 `startNode`。Worker 收到 NODE_READY 后，通过正式 Action 调用 `startNode`，Task 才把当前 run 变为 IN_PROGRESS。这样保持：

```text
Observer = detection
Carrier = physical wake
Worker = formal work acceptance
Task = workflow truth
```

## 5. 异步等待不自动变 Task WAITING

以下事实默认保持在原 Owner：

```text
Execution QUEUED/RUNNING/WAITING_APPROVAL
Collaboration PENDING/REPLY_PENDING_DELIVERY
Carrier recovery in progress
```

Task Node 可以继续保持 IN_PROGRESS；结果就绪后由 Observer resume Worker。只有 Worker 明确声明真正 workflow/business blocker 时，才使用 `waitNode` 进入 Task WAITING。

## 6. REASON 只作异常诊断旁路

正常 READY/RESULT/REPLY 不调用模型。只有单 Task 出现：

```text
多源事实冲突
UNKNOWN 无法确定 effect/delivery reality
长期 stalled 无单一 blocker
重复 recovery 失败
多个异常需要排序/归因
```

才允许把 bounded sanitized facts 交给 Model REASON。输出仅可包含 finding/probableCause/confidence/recommendedNextObservation/recommendedRecoveryAction/needsHumanAttention；不得直接 complete/reopen/approve/retry uncertain Effect。

## 7. Task 与 System Observer 分流

```text
单 Task / 单 run / 局部异常 → Task Diagnostic Assessment
多 Task / 跨服务 / 趋势性退化 → System Observer
```

Task Domain 不增加 Observer Store、Scheduler、AI Planner 或全局 Event Bus。

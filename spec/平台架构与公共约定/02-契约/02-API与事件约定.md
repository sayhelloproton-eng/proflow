---
docId: PLATFORM-DOC-02-02
title: 03｜API 与事件约定
docType: cross-domain-contract
authority: normative
lifecycle: active
domain: platform
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs: []
---

# 03｜API 与事件约定

> 状态：FROZEN  
> 目标：统一跨领域 Command、Query、Event、typed request、幂等、版本、异步结果、Observer 与 Human Channel 的交互规则。领域事实仍由 Owner Domain 定义，本文件只冻结跨域形式。

---

# 1. Public API 必须由事实 Owner 定义

Public API 必须回答：

```text
Owner 是谁？
解决哪个领域用例？
输入/输出 Contract 是什么？
成功/失败语义是什么？
是否幂等？
是否要求 expectedVersion？
是否产生 Event？
是否产生真实 Effect？
```

禁止为了“方便调用”暴露通用数据库 CRUD、任意 setStatus、Repository/ORM/internal Adapter。

---

# 2. Command / Query / Observation Request 分离

## 2.1 Query

Query MUST NOT 改变业务事实。允许 cache/metrics/trace 等技术副作用，但不能写 Domain state。

## 2.2 Command

Command 表达一个明确业务意图，例如：

```text
createTask
bindTaskWorker
startTask
startNode
completeNode
reopenNode
executeCapability
askPeer
replyPeer
```

v1 **没有 `authorizeTask`**。Extension 的“批准并开始”是 human interaction channel；Task READY 后用户确认，Channel 调用正式 `startTask`。Task 不保存独立 authorization/approval fact。

## 2.3 Observation / Drive Request

Observer 可以根据公开事实产生 typed request，例如：

```text
WAKE_WORKER
RESUME_WORKER
RECOVER_WORKER_PAGE
SHOW_APPROVAL_DIALOG
REQUEST_DRILLDOWN
```

它们不是 Domain Event，也不是“Observer 自己改业务状态”。真正业务写入仍由 Owner Command 完成；真实 Browser effect 仍经过 Execution/Carrier 边界。

---

# 3. API 不等于 HTTP

Public Contract 可以通过 HTTP、in-process Port、local transport、CLI Adapter、future Message Bus 等承载。Transport 不得把 HTTP/Express/SQLite 对象变成领域语义。

Custom GPT Actions 是 Agent Gateway 的外部 Carrier adapter。GPT-facing identity/idempotency/version/correlation 必须使用 typed body/path/query；不得依赖任意 Custom Headers。

---

# 4. 同步与异步

能在一次调用中确定完成的命令可以同步返回 owner result。需要外部系统、真实 Effect、长执行、Human Approval 或跨 Worker delivery 的动作，应快速返回稳定 ref/status，例如：

```text
executionRef
messageRef
taskId + nodeId + runNo
artifactRef
```

之后通过 Query、Event、owner-ready fact、Task Observer wake/resume 获得后续结果。

**异步等待不自动等于 Task WAITING。** Execution RUNNING/WAITING_APPROVAL、Collaboration PENDING、Carrier recovery 继续属于各自 Owner；真正 workflow blocker 才进入 Task 的 WAIT 语义。

---

# 5. Event 只表达“已经发生的事实”

Event SHOULD 使用过去事实语义，例如：

```text
TASK_COMPLETED
NODE_BECAME_READY
EXECUTION_RESULT_READY
COLLABORATION_REPLY_RECORDED
DELIVERY_CONFIRMED
PROVIDER_BECAME_UNAVAILABLE
```

`PLEASE_EXECUTE / DO_TASK / TRY_AGAIN` 属于 Command/Request，不是 Event。

Event immutable；只有事实 Owner 可以发布其事件。Task 不得伪造 Execution/Collaboration/Carrier 事实。

---

# 6. Event delivery 与业务 exactly-once 分开

平台 Event transport 默认不能假设 exactly-once。Consumer 必须幂等。

真实 Effect 的 exactly-once/effectively-once/UNKNOWN 由 Effect Owner 的 durable intent、idempotency、receipt/evidence 与 reality reconciliation 保证，不能用“Event 已消费”代替。

---

# 7. Worker Turn 不建 API/Event 生命周期

一个 Browser WAKE/Input 可启动一个语义上的 Worker Turn：Custom GPT 在同一 Conversation 内可连续调用 `0..N` Actions、File Bridge、Code Interpreter、Web Search，并根据 Action Result继续工作。

因此禁止设计：

```text
ACTION_FINISHED → Browser 再发 CONTINUE
每 Action 一个 Task Node
WorkerTurn Entity / Store / Runtime
Browser 解析 GPT 自然语言决定下一 Task Command
```

真正异步边界结束当前 Turn 后，由新 owner fact + Task Observer 再 WAKE 同一 Worker。

---

# 8. Task Observer / System Observer 的 API 边界

## Task Observer

读取 Task drive projection 与 Execution/Collaboration/Carrier public facts，做 deterministic next-step detection；只发 typed request，不写 Owner state。正常 READY/RESULT/REPLY 不调用模型。

单 Task conflicting facts / UNKNOWN / repeated recovery / unexplained stall 可请求 Model `task-diagnostic`，但模型只返回 finding/recommendation。

## System Observer

读取 bounded system views，调用低优先级 REASON 形成 derived assessment。它可以请求 drill-down/alert/UI/doctor，但不能直接 complete/reopen/approve/mark delivered/declare READY。

不建设统一 Global Scheduler / Event Bus 作为新事实 Owner。

---

# 9. Human Interaction Channel 与 Approval Owner 分开

必须区分四类：

1. Task start confirmation：Extension v1 / Feishu future → `startTask`；无 Task Approval entity。
2. Execution dangerous-effect approval：正式 fact 属于 Execution；Extension/Feishu 只是 UI channel。
3. Deployment `ACTION_REQUIRED(_WEB)`：人完成真实动作后 Deployment re-observe；不是 approval flag。
4. ChatGPT Action permission：OpenAI Carrier UI；routine control/intent operation `x-openai-isConsequential:false` + Always Allow，不能替代 Execution Approval。

---

# 10. 版本、幂等与 fresh reality

业务写请求按 Owner Contract 使用：

```text
actor/authenticated identity
idempotencyKey
expectedVersion（需要时）
current owner facts
```

Conversation memory、Browser DOM impression、Observer assessment、日志均不能替代 fresh owner state。

未知真实副作用：

```text
cannot prove applied
+ cannot prove absent
→ UNKNOWN
→ observe/reconcile reality
→ no blind replay
```

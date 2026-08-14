---
docId: AGENT-DOC-03-02
title: 智能体运行与协作领域｜Task Observer、Worker 与 Browser Carrier 驱动协议
docType: cross-domain-flow
authority: normative
lifecycle: active
domain: agent-runtime-collaboration
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- PLATFORM-DOC-01-04
- TASK-DOC-03-05
- AGENT-DOC-03-04
- AGENT-DOC-03-07
---

# 智能体运行与协作领域｜Task Observer、Worker 与 Browser Carrier 驱动协议

> 本文冻结 Agent 侧 Worker/Collaboration 与 Execution-owned Browser Carrier 的跨领域驱动方式。Extension Background 逻辑分为 Task Observer、System Observer、Carrier Controller；不再用一个“万能 Task Driver”同时承担 progression、系统评估和页面操作。

---

# 1. Owner 划分

## Task Domain

拥有：

```text
Task/Node lifecycle
requiredAgentPackageRef
TaskRoleBinding
runNo/version/idempotency
reopen/terminal truth
```

## Agent Domain

拥有：

```text
Agent Package
Role Registry
roleRef/credential semantics
Worker identity validation
Collaboration Thread/Message truth
```

## Execution Browser Carrier

拥有真实 Carrier mechanics：

```text
Conversation CREATE/RESTORE/WAKE
c-id/URL observation
page ready/DOM submit/screenshot
physical collaboration delivery
Effect reconciliation/recovery/evidence
```

## Task Observer

位于 Extension application/background，只做：

```text
read owner facts
→ deterministic next-step detection
→ request typed carrier/owner operation
```

不拥有 Task/Agent/Execution facts。

---

# 2. J1 New Task / Worker provisioning

```text
Extension New Task
→ Task createTask(PENDING)
→ fixed 3 agentPackageRefs
→ resolve registered roleRefs
→ Browser Carrier CREATE 3 new Conversations
→ observe workerRef/c-id + conversationLocator
→ Task bindTaskWorker × 3
→ Product immediately requirement discussion when bound
→ Dev/Test WORKER_BIND + IDLE
→ Product putTaskDocument(REQUIREMENT)
→ Task READY when all deterministic prerequisites satisfied
```

三路创建允许并发，partial success 只补缺失 binding。

**不再存在：**

```text
Product pre-Task createTask
user authorization then create Dev/Test
Task Scheduler creates workers
```

---

# 3. J2 Start

```text
Extension/未来 Feishu human confirmation
→ Task startTask
→ first business Node READY
```

Task start 不要求三个 tab 当前存活，也不 Browser wake。

---

# 4. J3 READY → RESTORE / WAKE

Task Observer 看到 current Node READY：

```text
get Task drive projection
→ requiredAgentPackageRef
→ TaskRoleBinding(roleRef/workerRef/conversationLocator)
→ request Carrier RESTORE/WAKE
```

Carrier：

```text
reuse/focus correct current tab if present
else open conversationLocator
→ wait page ready
→ validate observed Conversation identity
→ scroll/input/submit minimal trigger
→ reconcile physical delivery
```

WAKE 成功只是“消息真实进入正确 Conversation”，不代表 Node 成功。

---

# 5. Worker 正式启动 Node

顺序冻结为：

```text
Node READY
→ Worker WAKE delivered
→ Worker receives NODE_READY
→ Worker calls Task.startNode
→ Task validates binding/version/runNo
→ Node IN_PROGRESS
→ Worker continues current Turn
```

Task Observer 不替 Worker `startNode`；Browser 也不直接改 Node state。

如果 WAKE submit 后 reality UNKNOWN，先恢复同一 Conversation 并观察，不盲重发。

---

# 6. Worker Turn

一次 WAKE 启动一个 Worker Turn：

```text
Conversation context
→ native GPT capability
→ 0..N sequential Actions
→ Action result
→ more reasoning/actions
→ formal Task/Execution/Collaboration outcome
```

Browser **不在每个 Action 之间 WAKE**，不自动发送“继续”，不解析 GPT 最终自然语言决定 Task transition。

---

# 7. Async boundary 与 Resume

以下可能结束当前 Worker Turn：

```text
long Execution
Execution WAITING_APPROVAL
askPeer waiting reply
Carrier/human action
```

Owner result ready 后：

```text
Execution Result READY
Peer Reply READY
Reopen READY
→ Task Observer detects relevant condition
→ RESTORE/WAKE same Worker
→ new Worker Turn
```

这些 pending facts 默认不把 Task/Node变 WAITING。

---

# 8. Collaboration delivery

```text
askPeer
→ Agent durable message
→ resolve target TaskRoleBinding by targetAgentPackageRef
→ Carrier RESTORE/WAKE target
→ target replyPeer
→ Agent durable reply
→ Task Observer/Collaboration delivery path WAKE source
```

Collaboration 不创建 Worker、不自动推进 Task。

---

# 9. Reopen

```text
Task reopenNode
→ same nodeId
→ runNo + 1
→ same TaskRoleBinding
→ same workerRef/conversationLocator
→ Node READY
→ Task Observer WAKE original Worker
```

禁止创建新 Conversation。

---

# 10. Terminal

```text
Task terminal
→ Task Observer stop-driving guard
```

保留 Worker bindings/Conversation locator/Collaboration/Execution/Artifacts/Evidence/Logs 作为历史；System Observer仍可评估 dangling facts，但不能重新激活 Task。

---

# 11. Task Observer 与 System Observer 不合并

```text
Task Observer
= 某 Task 是否出现确定下一步？

System Observer
= 整个系统整体健康/风险/异常是什么？
```

Task Observer 正常 progression deterministic；只有单 Task conflicting facts/UNKNOWN/repeated recovery/unexplained stall 才允许 REASON diagnostic，且无 workflow authority。

System Observer 使用跨域 bounded snapshots + phone REASON，最低优先级，详见 Model/System Assessment 规范。

---

# 12. Browser 不承担大型上下文/普通文件运输

WAKE 只带小 control envelope。Requirement、Context Pack、patch、报告、日志 artifact 等走：

```text
Worker Action
→ Gateway
→ Task/Execution
→ File Bridge
→ Conversation
```

图片/页面恢复仍保留 Browser screenshot → Model Vision，因为 `openaiFileResponse` 不能替代 image return path。

---

# 13. Local auth

Browser Extension → local Runtime 使用 local platform auth；**不使用 GPT Role Bearer credential**。Role credential只用于 GPT Action → Gateway。

---
docId: AGENT-DOC-03-04
title: 智能体运行与协作领域｜Worker 唤醒与 Carrier Trigger 协议
docType: carrier-flow
authority: normative
lifecycle: active
domain: agent-runtime-collaboration
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- PLATFORM-DOC-01-04
- AGENT-DOC-03-02
- AGENT-DOC-03-07
---

# 智能体运行与协作领域｜Worker 唤醒与 Carrier Trigger 协议

> 本文只冻结注入 Worker Conversation 的**最小 trigger 语义**。Browser protocol/mechanics 属于 Execution；Agent 只定义 Role/Worker/Collaboration 所需 identity/intent。WAKE 不是大型 Context transport，也不是 Task transition。

---

# 1. Trigger 类型

v1 至少需要：

```text
WORKER_BIND
NODE_READY
REOPEN
PEER_MESSAGE
EXECUTION_RESULT_READY
PEER_REPLY_READY
RECOVERY_RESUME
```

`PEER_REPLY_READY` 可实现为 `PEER_MESSAGE(kind=REPLY)` 的语义别名；具体 wire enum 可收敛，但不得丢失原因区分。

---

# 2. Minimal Envelope

概念结构：

```json
{
  "protocol": "proflow.agent.browser-trigger.v1",
  "triggerRef": "wake-intent-...",
  "triggerType": "NODE_READY",
  "taskId": "task-001",
  "nodeId": "node-dev",
  "runNo": 1,
  "workerRef": "c-dev-001",
  "occurredAt": "...",
  "payload": {}
}
```

核心字段：

```text
taskId
nodeId? / runNo?
workerRef
triggerType
stable trigger/wake intent ref
```

`roleRef` 如现有 wire contract 已需要可携带，但不是 Browser credential；真正 GPT Role auth 仍由 Action credential → Gateway authenticatedRoleRef。

Browser 不注入完整 Requirement、代码、长日志或大型 artifact。

---

# 3. WORKER_BIND

只用于 J1 新 Conversation 初始化：

```text
Task 已存在(PENDING)
Conversation 已创建
Browser 正在确认 workerRef/c-id
```

Dev/Test payload 只需：

```text
taskId
workerRef
bind-only
remain waiting
```

Product 可带极短 requirement-start instruction。

WORKER_BIND 不表示 Node READY，不调用 `startNode/completeNode`。

---

# 4. NODE_READY

Task Observer 基于 Task owner fact 检测 READY，Carrier投递：

```json
{
  "triggerType": "NODE_READY",
  "taskId": "task-001",
  "nodeId": "node-dev",
  "runNo": 1,
  "workerRef": "c-dev-001"
}
```

Worker 收到后：

```text
必要时 getNodeContext
→ Task.startNode
→ Node IN_PROGRESS
→ current Worker Turn继续
```

不要求 WAKE 正文包含 expectedVersion；版本应从 fresh Task query/Action获得，避免把 stale version 当长期 Carrier context。

---

# 5. REOPEN

```text
same taskId
same nodeId
runNo + 1
same workerRef
```

payload 可带 bounded reopen reason/ref；完整 Test Result/Artifact 通过 Task/Execution/File Bridge取得。

Carrier不得新建 Worker、不得概括/改写成不同 business reason。

---

# 6. PEER_MESSAGE / PEER_REPLY_READY

携带最小 durable Collaboration refs：

```text
threadId
messageRef
kind QUESTION|REPLY
sourceWorkerRef
```

正文可作为消息 payload进入 Conversation，但正式 truth 仍在 Collaboration Message Center。收到 Peer Message 不等于 Task state变化。

---

# 7. EXECUTION_RESULT_READY

长 Execution 结束后可唤醒原 Worker：

```text
executionRef
status/result summary
artifact/evidence refs
```

大型 stdout/artifact 通过 Action/File Bridge按需读取。该 trigger 不自动 complete Node。

---

# 8. RECOVERY_RESUME

只表示技术链路恢复：

```text
business state unchanged
same task/node/run/worker
```

不得用它模拟 reopen。

---

# 9. Carrier Identity 校验

投递前至少确认：

```text
当前是受支持 ChatGPT 页面
observed c-id == expected workerRef
expected role/GPT identity consistent with binding
```

不建设：

```text
Frame Registry
frame-role handshake
iframe workspace
persistent tab identity
```

`tabId` 只是当前 runtime address。

---

# 10. Delivery idempotency / UNKNOWN

同一：

```text
taskId + nodeId + runNo + triggerType + underlying result/message ref
```

必须能形成稳定 wake intent。

如果 submit 前明确失败 → bounded retry。

如果 submit 后断联：

```text
re-open same Conversation
→ observe whether trigger already exists
├─ confirmed delivered → reuse success
├─ confirmed absent → retry
└─ cannot prove → UNKNOWN / no blind replay
```

真实 delivery durability/evidence 归 Execution Browser path。

---

# 11. Worker Turn

一次成功 WAKE 启动一个 Worker Turn，而不是一个 Action。

同一 Turn 内 0..N Actions可连续发生；Browser 不：

```text
每 Action 再 WAKE
自动输入“继续”
解析 GPT reply 判断“是否继续”
```

跨 Worker、长 Execution、Approval 等异步边界才需要新的 Turn。

---

# 12. File / Context boundary

Browser trigger 只传 control plane。动态文档/文件：

```text
TaskDocument / Execution Artifact
→ Gateway openaiFileResponse
→ Conversation
```

GPT生成文件：

```text
openaiFileIdRefs
→ Gateway
→ Execution materialize
```

Screenshot/Vision 独立保留。

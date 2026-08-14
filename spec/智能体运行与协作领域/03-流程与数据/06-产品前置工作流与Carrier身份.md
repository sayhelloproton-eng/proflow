---
docId: AGENT-DOC-03-06
title: 智能体运行与协作领域｜New Task、Product Worker 与 Carrier Identity
docType: business-flow
authority: normative
lifecycle: active
domain: agent-runtime-collaboration
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- PLATFORM-DOC-01-04
- TASK-DOC-02-01
---

# 智能体运行与协作领域｜New Task、Product Worker 与 Carrier Identity

> 2026-08-14 正式改为 **Extension-first New Task**。旧的“用户先打开 Product GPT → Product GPT listRegisteredRoles/createTask”主路径废止。

## 1. New Task 唯一入口

```text
Extension Task UI
→ New Task
→ Task createTask(PENDING)
→ taskId
```

Task 必须先存在，随后三个 Worker 才能明确绑定该 taskId，避免产生无主 Conversation。

---

## 2. 三 Worker 一次组队

Background Carrier Controller 对固定三个 `agentPackageRef`：

```text
Product
Controller/Dev
Test/Ops
```

解析当前 registered `roleRef`，并发：

```text
open role
→ create new Conversation
→ observe c-id / workerRef
→ record conversationLocator
→ validate page/Role identity
→ Task bindTaskWorker
```

一个 Task 一个三人组；不同 Task 不复用 Conversation。同一 Task 的 reopen 永远复用原 Worker/Conversation。

---

## 3. Product 可以先进入需求沟通

三路 provisioning 可以并发；只要 Product Worker 已绑定：

```text
Product Conversation
→ requirement discussion
→ clarify objective/scope/constraints
→ putTaskDocument(REQUIREMENT)
```

Dev/Test 即使已绑定，也只保持 IDLE，直到其 Node READY/Peer Message 等正式 trigger。

Product 不必等待 Dev/Test 两个 binding 完成才和用户沟通；但 Task 不能 start，直到所有 Frozen prerequisites满足。

---

## 4. 新 Conversation 最小初始化

如果真实 ChatGPT 页面必须发生一次 message 才出现稳定 c-id：

### Product

允许最小 requirement-start message：

```text
taskId
workerRef（观察后确认）
“开始本 Task 的需求沟通”
```

### Dev/Test

仅允许最小 WORKER_BIND：

```text
taskId
workerRef
bind-only
remain waiting
```

不注入完整 Requirement/代码/测试材料。

---

## 5. Partial success / 恢复

例如：

```text
Product BOUND
Dev BOUND
Test MISSING
```

恢复必须：

```text
保留 Product/Dev
只补 Test
```

Create/submit 后若 Effect reality 不确定，必须先重新观察当前 ChatGPT reality，不能盲目重建 Conversation。

---

## 6. Carrier Identity

正式身份链：

```text
agentPackageRef/packageName = logical role
roleRef/g-id              = deployed Custom GPT
workerRef/c-id             = Task Worker Conversation
conversationLocator        = restore locator
```

Browser 可使用 `tabId` 操作当前页面，但 Task 不持久化 tab/frame。

Custom GPT Action **不提供稳定 c-id**，所以不能依赖 Action request 自动识别当前 Conversation。Worker identity 由 Browser/Carrier page observation 取得并验证，再通过 Task Public Contract绑定。

---

## 7. Product 不再承担 Role discovery / Task creation

Product GPT runtime Actions 主路径不需要：

```text
listRegisteredRoles
getRegisteredRole
createTask
```

Role Registry 仍保留给：

```text
Deployment
Carrier coordination
management/doctor
```

Task creation 由 Extension/platform-host 发起。

---

## 8. Requirement / File Bridge

Product 可以使用 Conversation native file handling / Code Interpreter 生成 requirement/PRD artifact；需要进入平台正式事实时：

```text
Conversation file
→ openaiFileIdRefs
→ Gateway normalize
→ Execution materialize（需要 bytes 时）
→ Task putTaskDocument / artifact reference
```

Conversation File 不是 TaskDocument；OpenAI file id 不是长期业务 identity。

---

## 9. J1 完成条件

J1 结束于：

```text
3 TaskRoleBindings complete
+
Product Requirement formalized in Task
+
Task deterministic readiness = READY
```

随后才进入 J2 human confirmation → `startTask`。

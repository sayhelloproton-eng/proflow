---
docId: AGENT-DOC-02-01
title: 智能体运行与协作领域｜Public API 与跨领域接口矩阵
docType: contract
authority: normative
lifecycle: active
domain: agent-runtime-collaboration
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- PLATFORM-DOC-01-04
- AGENT-DOC-03-07
---

# 智能体运行与协作领域｜Public API 与跨领域接口矩阵

> 2026-08-14 对齐：Extension 是 v1 New Task 唯一入口；三个固定 Role 的 logical identity 由 Agent packageName/`agentPackageRef` 表达，实际 Custom GPT identity 为 `roleRef`，Task Worker 为 `workerRef`。Product GPT 不再负责 pre-Task `createTask/listRegisteredRoles` 主链。

## 1. Agent Domain Provides

### 1.1 Role Registry（管理/Deployment/Carrier lookup）

#### `listRegisteredRoles`

消费者：Deployment、Carrier coordination、管理 CLI/UI、内部诊断。

语义：返回工作区已注册 Role，可按 `agentPackageRef` 过滤。它是**管理与解析能力**，不是 Product GPT 创建 Task 的 runtime Action 主链。

#### `getRegisteredRole`

消费者：Carrier coordination、Deployment/管理面。

语义：

```text
agentPackageRef / roleRef
→ carrierType
→ carrierUrl-or-gptId metadata
→ registeredPackageVersion
```

Role Registry 不持有 Task binding。

### 1.2 Worker identity validation

Agent Runtime 对 `roleRef/workerRef` 的 Role/Carrier 语义提供校验/解析能力。TaskRoleBinding 的持久化仍归 Task Domain；Browser/Carrier 负责真实 Conversation c-id/URL observation。

### 1.3 Collaboration

#### `askPeer`

关键输入：

```text
taskId
fromWorkerRef
targetAgentPackageRef
threadId?
content
idempotencyKey
```

`fromRoleRef` 由 Gateway credential 认证确定。Agent Runtime 通过 Task Public Contract 验证 sender/target 属于同一 Task，并把固定 `targetAgentPackageRef` 解析为该 Task 已绑定的 `targetRoleRef + targetWorkerRef + conversationLocator`。

#### `replyPeer`

关键输入：

```text
threadId
fromWorkerRef
content
idempotencyKey
```

reply target 由 durable Thread current state 决定，模型不能自由改写目标。

### 1.4 Agent-internal delivery coordination

Collaboration logical message 属于 Agent；physical delivery 通过 Execution Browser Carrier。Agent 可以提供 pending delivery projection/result acknowledgement contract，但不能自己操作 ChatGPT DOM。

---

## 2. Local management surface

以下是本地管理/Deployment surface，不是 GPT runtime Actions：

```text
custom-gpt setup/materialize/show
role register
role show/list/validate/delete
role key show/rotate
```

---

## 3. Requires｜Task Domain

Agent/Gateway/Observer 只通过 Task Public Contract 使用：

```text
listTasks
getTask
getTaskDriveProjection
bindTaskWorker
startTask
getNodeContext
startNode
completeNode
waitNode
failNode
reopenNode
putTaskDocument
getTaskDocument
listPendingMessages（Task-owned workflow message only）
```

`createTask` 属于 Extension/platform-host New Task flow，不是 Product GPT Action 主链。

### 3.1 TaskRoleBinding

Task binding 统一表达：

```json
{
  "agentPackageRef": "@tomflow/proflow-agent-controller-dev",
  "roleRef": "g-dev",
  "workerRef": "c-dev-001",
  "conversationLocator": "https://chatgpt.com/..."
}
```

规则：

- stable key = `(taskId, agentPackageRef)`；
- `agentPackageRef/packageName` = logical role type；
- `roleRef` = deployed Custom GPT g-id；
- `workerRef` = Task-scoped Conversation identity；
- `conversationLocator` = page restore locator；
- Task 不持久化 tab/frame；
- reopen 保留整条 TaskRoleBinding。

### 3.2 Node role requirement

Node 使用：

```text
requiredAgentPackageRef
```

而不是用 `roleRef/g-id` 表达逻辑岗位。

### 3.3 Drive projection

Task Query 必须能提供：

```text
Task/Node current state
requiredAgentPackageRef
current roleBinding
currentNodeId/runNo/version
canDrive/blockedReason
terminal
```

Task Observer 不复制 eligibility/state-machine。

---

## 4. Requires｜Execution Domain

Agent 只通过 Execution canonical Public Contract 请求真实 Effect：

```text
executeCapability(...)
getExecution(...)
readExecutionOutput(...)
cancelExecution(...)
```

真实：

```text
File/Git/Shell/Process/Network/Browser submit
Artifact materialization
Result/Evidence
Effect Approval
UNKNOWN/recovery
```

全部归 Execution。

### 4.1 GPT 文件进入平台

```text
openaiFileIdRefs
→ Gateway normalization
→ Execution bounded fetch/materialize/hash/MIME/size/scope
→ artifactRef / canonical TaskDocument input
```

### 4.2 平台文件回 GPT

```text
TaskDocument / Execution Artifact
→ Gateway openaiFileResponse
→ current Worker Conversation
```

File Bridge 是 transport，不改变 Owner。

---

## 5. Requires｜Deployment Domain

Agent 只依赖 Deployment 的通用 Module Governance：package install/uninstall、Module discovery/topology，以及 `install/status/setup/docs/start/stop` 标准调用。Agent Package / Gateway / Carrier 的私有 config、Role readiness、Actions/Auth/Capabilities verification 均由 owning Module 自己实现。

需要 Web-only 人工动作时由 `Module.setup` 返回 `ACTION_REQUIRED`；Role READY 仍按 behavior/capability/auth verification，不按 exact model id。Platform 不提供 verify/doctor/upgrade 第二套业务真源。

---

## 6. Agent ↔ Browser Carrier 边界

### Agent provides

```text
Registered Role lookup
Worker identity validation
Collaboration logical message truth
```

### Task provides

```text
TaskRoleBinding
Task drive projection
Node/workflow commands
```

### Execution Browser provides

```text
Conversation CREATE / RESTORE / WAKE
c-id / Conversation URL observation
page state / screenshot / recovery
physical collaboration delivery
Browser Effect Result/Evidence
```

Browser 不持有 Role Bearer credential，也不直接写 Task/Agent Store。

---

## 7. New Task main path

正式顺序：

```text
Extension New Task
→ Task createTask(PENDING)
→ 读取三个固定 agentPackageRef → registered roleRef
→ Carrier 并发创建 Product/Dev/Test 新 Conversation
→ observe workerRef + conversationLocator
→ Task bindTaskWorker × 3（partial success 只补缺失）
→ Product bound 后即可 requirement discussion
→ Product putTaskDocument(REQUIREMENT)
→ deterministic readiness → Task READY
→ human confirmation channel → startTask
```

Product GPT 不调用：

```text
listRegisteredRoles
getRegisteredRole
createTask
```

作为主业务入口。

---

## 8. Worker Turn / Actions

一次 WAKE 启动一个 Worker Turn；同一 Turn 内 Custom GPT 可以调用 `0..N` 个 Actions。Browser 不在每个 Action 之间机械 WAKE，也不通过自然语言回复判断 Task 下一步。

Native GPT capability 优先级：

```text
知识/公开 research → Conversation/Web Search
多文件/数据/代码分析 → File Bridge + Code Interpreter
正式 ProFlow facts → Actions
真实机器/外部 Effect → Execution
跨 Worker → Collaboration
```

---

## 9. API identity / actorRef

```text
Bearer credential → authenticatedRoleRef
request workerRef → Task binding validation
actorRef → Gateway 按 authenticated role + validated worker 规范化
```

模型不得自由伪造 `roleRef/actorRef`；Browser 不参与 Role credential 验证。

---

## 10. OpenAI transport boundary

GPT-facing contract 不依赖 arbitrary custom headers。以下字段通过 typed body/path/query：

```text
taskId
nodeId
workerRef
idempotencyKey
correlationId
expectedTaskVersion
expectedNodeVersion
```

`openaiFileIdRefs/openaiFileResponse/x-openai-isConsequential` 只属于 Carrier transport，不进入 Owner business identity。

Routine query/control/intent Action 应显式 `x-openai-isConsequential:false`；真实高风险 Effect 是否需要 Approval仍由 Execution Policy决定。

---

## 11. Ownership summary

- Agent：Role Registry/Worker identity validation/Collaboration。
- Task：TaskRoleBinding/workflow/TaskDocument。
- Execution：real Effect/Artifact/Result/Evidence/Browser physical delivery/Approval。
- Gateway：auth/protocol adaptation/routing；不持久化第二份 business state。
- Task Observer：deterministic next-step detection；不是 Owner。
- System Observer：cross-system derived assessment；不是 Owner。

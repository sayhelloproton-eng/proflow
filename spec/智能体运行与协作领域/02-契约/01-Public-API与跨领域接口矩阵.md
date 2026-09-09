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
custom-gpt setup / show-* / action-schema
custom-gpt finalize-role
role register/show/list/validate/delete
role key show/rotate
```

Role/credential 的 canonical owner API 属于 Agent Domain；CLI 是显式本地 wrapper。正常 Deployment setup 可以直接组合 owner capability 与 `custom-gpt-web-provisioning`，不要求通过 CLI 文本输出重新解析业务状态。

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

## 4. Requires｜Direct Tools 与 Execution

### 4.1 Direct Tool Actions

GPT-facing 本地工程能力固定为三类：

```text
repomix(operation, input)
localDev(operation, input)
codeGraph(operation, input)
```

它们统一走 `Gateway → ProFlow API → Browser Extension → execution-local Tool implementation → macOS`。Browser Extension 是本机资源统一物理执行入口，platform-host 不得绕过它直连工具；该链不进入旧 `executeCapability/getExecution/readExecutionOutput` lifecycle。Tool request 不得包含 `taskId/nodeId/runNo/workerRef/roleRef/executionRef` 等系统身份；Gateway credential 只得到 authenticated Role，Workspace 与 Extension/本机 bridge 目标由部署事实绑定。工具原生 `outputId/processId/searchId` 可以作为同工具后续调用句柄。

### 4.2 Execution internal dependency

Agent/Gateway 不再向 GPT 暴露 `executeCapability/getExecution/readExecutionOutput`。Execution 只作为平台内部 Browser/Carrier、physical collaboration delivery、Approval/UNKNOWN recovery、external-file materialization 等 durable effect 机制存在；这些内部 contract 不是 Worker 工具心智。

### 4.3 GPT 文件进入平台

```text
openaiFileIdRefs
→ Gateway normalization
→ Execution bounded fetch/materialize/hash/MIME/size/scope
→ artifactRef / canonical TaskDocument input
```

### 4.4 平台文件回 GPT

```text
TaskDocument / Execution Artifact
→ Gateway openaiFileResponse
→ current Worker Conversation
```

File Bridge 是 transport，不改变 Owner。

---

## 5. Requires｜Deployment Domain

Agent 只依赖 Deployment 的通用 Module Governance：package install/uninstall、Module discovery/topology，以及 `install/status/setup/docs/start/stop` 标准调用。Agent Package / Gateway / Carrier 的私有 config、Role readiness、Actions/Auth/Capabilities verification 均由 owning Module 自己实现。

需要真实外部人工动作时由 `Module.setup` 返回 `ACTION_REQUIRED`；Real-2 正常 Golden Path 默认只保留 Browser Extension 首次“加载已解压的扩展程序”这一人工动作。Custom GPT 字段、Knowledge、Schema、Role/Auth 不以人工复制粘贴作为 happy path。Role READY 仍按 behavior/capability/auth verification，不按 exact model id。Platform 不提供 verify/doctor/upgrade 第二套业务真源。

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

Browser 不拥有或持久化 Role Bearer credential，也不直接写 Task/Agent Store；仅 deployment-only Auth finalization command 可以在内存中短暂接收 credential，完成 Web 输入后立即丢弃。

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

Native GPT capability / Tool 优先级：

```text
知识/公开 research → Conversation/Web Search
临时数据/文件分析 → File Bridge + Code Interpreter
正式 Task/Node/Document facts → Task Actions
本地仓库/文件/命令/结构关系 → Repomix / Local Dev / CodeGraph
Browser/Carrier durable effect → Execution internal path
跨 Worker → Collaboration
```

---

## 9. API identity / actorRef

Task/Peer Actions：

```text
Bearer credential → authenticatedRoleRef
request workerRef（仅业务合同确实需要时）→ Task binding validation
actorRef → Gateway 按 authenticated role + validated worker 规范化
```

Direct Tool Actions：

```text
Bearer credential → authenticatedRoleRef
request body → operation + business input only
workspace/provider/credential → server-bound config
```

Direct Tool request 不允许 `taskId/nodeId/runNo/workerRef/roleRef/actorRef/executionRef` 充当工具身份字段。模型不得自由伪造 `roleRef/actorRef`；Browser 不参与 Role credential 验证。

---

## 10. OpenAI transport boundary

GPT-facing contract 不依赖 arbitrary custom headers。Task/Peer Actions 若业务合同需要 Task/Node/version/idempotency 等字段，继续通过 typed body/path/query 表达；**Direct Tool Actions 不携带这些业务身份字段**，只传 `operation + input`。

`openaiFileIdRefs/openaiFileResponse/x-openai-isConsequential` 只属于 Carrier transport，不进入 Owner business identity。

每个 Action 显式 `x-openai-isConsequential`。Task query/Peer query 等按真实语义设置；Direct Tool read 通常为 `false`，Local Dev mutation/command 按真实副作用设置，不能再以“只是提交 Execution intent”为理由统一标 `false`。

---

## 11. Ownership summary

- Agent：Role Registry/Worker identity validation/Collaboration/Custom GPT Action surface。
- Task：TaskRoleBinding/workflow/TaskDocument。
- Tools：Repomix / Local Dev / CodeGraph 的产品 Tool contract；API/host 只做 auth/admission/typed command/correlation，Browser Extension Local Tool lane 是统一本机 Effect Gate，`execution-local` 承载真实实现。
- Execution：Browser/Carrier durable Effect/Artifact/Result/Evidence/physical delivery/Approval/UNKNOWN recovery。
- Gateway：auth/protocol adaptation/routing；不持久化第二份 business state。
- Task Observer/Reconciliation：backend deterministic next-step detection + bounded catch-up；不是 Owner。
- System Observer：cross-system derived assessment；不是 Owner，且不阻塞 progression。

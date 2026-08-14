---
docId: TASK-DOC-02-01
title: 任务与编排领域｜Public API Contract v0.2
docType: contract
authority: normative
lifecycle: active
domain: task-orchestration
subdomain: null
subdomains:
- task-lifecycle
- task-chain
- node-workflow
- task-documents
- message-event-audit
provides: []
requires: []
contractRefs:
- PLATFORM-DOC-01-04
- TASK-DOC-03-05
---

# 任务与编排领域｜Public API Contract v0.2

> 本文冻结第一版 Task Public API 的业务语义。2026-08-14 起，Task 创建入口、三 Worker 绑定、Task start confirmation、Task Observer 与异步等待边界统一按 `PLATFORM-DOC-01-04` 与 `TASK-DOC-03-05` 对齐。最终 HTTP path / TypeScript function name / OpenAPI operationId 可机械映射，但不得改变本文事实所有权与状态语义。

---

# 1. Public API 分层原则

```text
Task Domain Public API
≠ Custom GPT Action 列表
≠ Browser Extension API
≠ Task Observer runtime
```

- Task Domain 只拥有 Task/TaskGroup/Node/TaskRoleBinding/TaskDocument/TaskEvent 等 Task 事实。
- Extension 是 v1 New Task 与 human-start-confirmation UI；它通过 platform-host/Public Contract 调 Task，不直接读写 Task Store。
- Task Observer 位于 Extension application/background，读取 Task drive projection 与其他 Owner 的 current facts，只发 typed wake/resume request，不写 Task。
- Browser Carrier 负责 Conversation CREATE/RESTORE/WAKE/physical delivery，不是 Task Owner。
- Gateway 可把 Task operation 暴露给 GPT，但不能改变 Task Contract。

---

# 2. 公共 Envelope

成功：

```json
{
  "contract": "task-orchestration",
  "contractVersion": "1.0.0",
  "ok": true,
  "data": {}
}
```

失败：

```json
{
  "contract": "task-orchestration",
  "contractVersion": "1.0.0",
  "ok": false,
  "error": {
    "code": "TASK_VERSION_CONFLICT",
    "message": "Task version does not match.",
    "retryable": true,
    "correlationId": "corr-...",
    "details": {}
  }
}
```

`retryable=true` 只表示修正 current reality 后允许再次尝试，不表示允许对真实 Effect 盲重放。

---

# 3. 写操作公共字段

| 字段 | 类型 | 必填 | 含义 |
|---|---|---:|---|
| `actorRef` | string | 是 | 业务动作主体 opaque ref；由可信边界规范化 |
| `idempotencyKey` | string | 是 | Owner-domain 业务幂等键 |
| `expectedTaskVersion` | integer | 依接口 | 防止 stale Task write |
| `expectedNodeVersion` | integer | 依接口 | 防止 stale Node write |
| `expectedGroupVersion` | integer | 依接口 | 防止 stale TaskGroup write |

Custom GPT 请求中的 authenticated Role 由 Gateway credential 决定；模型不能自报/覆盖可信身份。

---

# 4. API 总表

| # | API | 主要调用者 | 修改状态 |
|---:|---|---|---:|
| 1 | `createTaskGroup` | Product/Controller management flow | 是 |
| 2 | `getTaskGroup` | platform-host / management | 否 |
| 3 | `startTaskGroup` | Human channel / platform-host | 是 |
| 4 | `createTask` | **Extension New Task / platform-host** | 是 |
| 5 | `listTasks` | Extension UI / Task Observer / management | 否 |
| 6 | `getTask` | Worker / Extension / Task Observer / management | 否 |
| 7 | `startTask` | **Extension human-confirmation channel / platform-host** | 是 |
| 8 | `pauseTask` | Human / Controller | 是 |
| 9 | `resumeTask` | Human / Controller | 是 |
| 10 | `terminateTask` | Human / Controller | 是 |
| 11 | `bindTaskWorker` | platform-host / Carrier provisioning flow | 是 |
| 12 | `getTaskDriveProjection` | **Task Observer** | 否 |
| 13 | `getNodeContext` | Worker | 否 |
| 14 | `startNode` | **Task-bound Worker after WAKE** | 是 |
| 15 | `completeNode` | Worker | 是 |
| 16 | `waitNode` | Worker | 是 |
| 17 | `failNode` | Worker / Controller | 是 |
| 18 | `reopenNode` | Controller | 是 |
| 19 | `putTaskDocument` | Product/Worker | 是 |
| 20 | `getTaskDocument` | Worker / management | 否 |
| 21 | `listPendingMessages` | management / human UI | 否 |
| 22 | `acknowledgeMessage` | Human / Controller | 是 |
| 23 | `listTaskEvents` | management / audit | 否 |

**v1 不存在 `authorizeTask`。** Extension 的“批准并开始”是 human interaction channel，确认后直接调用 `startTask`；Task 不持久化独立 Approval/authorization 事实。

---

# 5. TaskGroup API

TaskGroup 仍是串行大型任务链容器。其 `startTaskGroup` 是 group-level lifecycle command，不等价于 Execution Effect Approval，也不向成员 Task 注入 authorization 事实。

## 5.1 createTaskGroup

请求：

```json
{
  "taskGroupId": "tg-001",
  "title": "大型系统第一阶段",
  "objective": "完成第一阶段所有模块",
  "maxActiveTasks": 1,
  "actorRef": "product:worker",
  "idempotencyKey": "idem:create-tg-001"
}
```

v1 `maxActiveTasks` 必须为 1。

## 5.2 getTaskGroup

返回 group current status/version、顺序 Task 摘要与计算字段 `currentTaskId`；不复制成员 Task 全量事实。

## 5.3 startTaskGroup

```json
{
  "taskGroupId": "tg-001",
  "expectedGroupVersion": 2,
  "actorRef": "human:operator",
  "idempotencyKey": "idem:start-tg-001"
}
```

效果：`READY → ACTIVE`。成员 Task 仍必须各自满足自身 readiness，并通过 `startTask` 才进入 ACTIVE。

---

# 6. Task API

## 6.1 createTask

用途：**Extension New Task** 先创建一个 `PENDING` Task，并声明 ordered business Nodes、三个固定逻辑岗位以及可选初始文档。Product 需求沟通发生在该 PENDING Task 内，不再由 Product GPT 在 Task 之前创建 Task。

概念请求：

```json
{
  "taskId": "task-001",
  "taskGroupId": "tg-001",
  "sequenceNo": 1,
  "title": "实现用户管理模块",
  "objective": "完成用户管理模块研发与验收",
  "plan": {
    "nodes": [
      {
        "nodeId": "node-dev",
        "title": "研发与项目管理",
        "objective": "完成技术设计和研发",
        "requiredAgentPackageRef": "@tomflow/proflow-agent-controller-dev",
        "inputDocuments": ["REQUIREMENT"],
        "outputDocuments": ["TECHNICAL_DESIGN"]
      },
      {
        "nodeId": "node-test",
        "title": "测试与运维验收",
        "objective": "完成测试、验证与运维验收",
        "requiredAgentPackageRef": "@tomflow/proflow-agent-test-ops",
        "inputDocuments": ["REQUIREMENT", "TECHNICAL_DESIGN"],
        "outputDocuments": ["TEST_RESULT"]
      }
    ]
  },
  "roleBindings": [
    {
      "agentPackageRef": "@tomflow/proflow-agent-product",
      "roleRef": "g-product",
      "workerRef": null,
      "conversationLocator": null
    },
    {
      "agentPackageRef": "@tomflow/proflow-agent-controller-dev",
      "roleRef": "g-dev",
      "workerRef": null,
      "conversationLocator": null
    },
    {
      "agentPackageRef": "@tomflow/proflow-agent-test-ops",
      "roleRef": "g-test",
      "workerRef": null,
      "conversationLocator": null
    }
  ],
  "actorRef": "extension:new-task",
  "idempotencyKey": "idem:create-task-001"
}
```

### 关键字段

| 字段 | 语义 |
|---|---|
| `requiredAgentPackageRef` | Node 的**逻辑岗位要求**；第一版就是三个固定 Agent packageName 之一 |
| `roleBindings[].agentPackageRef` | Task 内逻辑岗位 stable key |
| `roleBindings[].roleRef` | 当前实际部署的 Custom GPT g-id；opaque |
| `roleBindings[].workerRef` | Task-scoped Worker / Conversation identity；创建时允许 null |
| `roleBindings[].conversationLocator` | 可恢复同一 Conversation 页面的 locator；创建时允许 null |

### 约束

- `agentPackageRef` 在 Task 内唯一；v1 必须声明 Product / Controller-Dev / Test-Ops 三个固定岗位。
- `roleRef` 是 deployed GPT identity，不是 logical role type。
- Task 不持久化 `tabId/frameId/windowId`。
- Requirement 阶段默认不是一个 Product business Node；Product 在 PENDING 阶段将正式 Requirement 写入 TaskDocument。
- 如果未来某 Task 明确需要 Product business Node，可由 Plan 显式声明，但不能用它替代 J1 requirement setup。

响应：

```json
{
  "taskId": "task-001",
  "status": "PENDING",
  "version": 1,
  "planVersion": 1,
  "currentNodeId": null,
  "roleBindings": [
    {"agentPackageRef":"@tomflow/proflow-agent-product","roleRef":"g-product","workerRef":null,"conversationLocator":null},
    {"agentPackageRef":"@tomflow/proflow-agent-controller-dev","roleRef":"g-dev","workerRef":null,"conversationLocator":null},
    {"agentPackageRef":"@tomflow/proflow-agent-test-ops","roleRef":"g-test","workerRef":null,"conversationLocator":null}
  ],
  "readiness": {
    "ready": false,
    "missing": ["PRODUCT_WORKER", "DEV_WORKER", "TEST_WORKER", "REQUIREMENT"]
  }
}
```

Task 可以在后续 `bindTaskWorker` / `putTaskDocument(REQUIREMENT)` 成功后重新计算 readiness；当所有冻结前置条件满足时 `PENDING → READY`。该转换是 Task deterministic fact，不依赖 Approval record。

---

## 6.2 bindTaskWorker

用途：把 Browser Carrier 已创建/恢复并由 Agent/Carrier 验证的真实 Worker identity 固化为 Task `TaskRoleBinding`。

请求：

```json
{
  "taskId": "task-001",
  "agentPackageRef": "@tomflow/proflow-agent-controller-dev",
  "roleRef": "g-dev",
  "workerRef": "c-dev-001",
  "conversationLocator": "https://chatgpt.com/g/g-dev/c/c-dev-001",
  "expectedTaskVersion": 2,
  "actorRef": "platform-host:worker-provisioning",
  "idempotencyKey": "idem:bind-task-001-dev"
}
```

语义：

- stable key = `(taskId, agentPackageRef)`；
- `agentPackageRef` 必须是 Task 已声明岗位；
- `roleRef` 必须与当前待绑定岗位的 deployed Role 一致；
- empty binding → complete binding 是允许的一次性写入；
- 相同 `roleRef + workerRef + conversationLocator` 重放返回原结果；
- 尝试替换成不同 Worker/Conversation 返回 `TASK_ROLE_BINDING_CONFLICT`；
- terminal Task 默认拒绝修改；
- reopen 不删除 binding；
- 绑定成功后 Task 重新计算 readiness。

Task 不接收/保存 Chrome `tabId`。

---

## 6.3 listTasks

支持按 group/status 等筛选，返回 UI/Observer 所需 bounded summary，不返回全部 Markdown 正文。

示例：

```json
{
  "tasks": [
    {
      "taskId": "task-001",
      "title": "实现用户管理模块",
      "status": "READY",
      "version": 5,
      "currentNodeId": null,
      "canStart": true,
      "blockedReason": null
    }
  ]
}
```

`canStart/blockedReason` 由 Task Domain 计算；调用者不得复制 eligibility 规则。

---

## 6.4 getTask

返回 Task current truth、Nodes、TaskRoleBindings 与必要 bounded metadata。

```json
{
  "taskId": "task-001",
  "status": "ACTIVE",
  "version": 8,
  "planVersion": 1,
  "currentNodeId": "node-dev",
  "roleBindings": [
    {
      "agentPackageRef": "@tomflow/proflow-agent-product",
      "roleRef": "g-product",
      "workerRef": "c-product-001",
      "conversationLocator": "https://chatgpt.com/..."
    },
    {
      "agentPackageRef": "@tomflow/proflow-agent-controller-dev",
      "roleRef": "g-dev",
      "workerRef": "c-dev-001",
      "conversationLocator": "https://chatgpt.com/..."
    },
    {
      "agentPackageRef": "@tomflow/proflow-agent-test-ops",
      "roleRef": "g-test",
      "workerRef": "c-test-001",
      "conversationLocator": "https://chatgpt.com/..."
    }
  ],
  "nodes": [
    {
      "nodeId": "node-dev",
      "status": "IN_PROGRESS",
      "runNo": 1,
      "requiredAgentPackageRef": "@tomflow/proflow-agent-controller-dev",
      "workerRef": "c-dev-001",
      "version": 3
    },
    {
      "nodeId": "node-test",
      "status": "PENDING",
      "runNo": 0,
      "requiredAgentPackageRef": "@tomflow/proflow-agent-test-ops",
      "workerRef": null,
      "version": 1
    }
  ]
}
```

不返回 `authorizedByRef/authorizedAt`，因为 v1 不拥有 Task authorization fact。

---

## 6.5 startTask

用途：Extension/未来 Feishu 等 human interaction channel 获得用户确认后，提交正式 Task start command。

请求：

```json
{
  "taskId": "task-001",
  "expectedTaskVersion": 5,
  "actorRef": "human:operator",
  "idempotencyKey": "idem:start-task-001"
}
```

Task 必须重新读取并验证：

```text
Task == READY
Requirement formal document exists
3 required TaskRoleBindings complete
TaskGroup prerequisite satisfied（如适用）
expectedTaskVersion current
idempotency current
```

**不检查三个 Browser tabs 是否当前存活。**

效果：

```text
Task READY → ACTIVE
first business Node PENDING → READY
currentNodeId = firstNode
```

Task 到此停止；Browser restore/wake 由 Task Observer + Carrier 完成。

---

## 6.6 pauseTask / resumeTask / terminateTask

沿现有生命周期语义：

- `pauseTask`：Task → PAUSED；不伪造/重写 Execution、Collaboration、Browser facts。
- `resumeTask`：PAUSED/真实 workflow WAITING 按合法状态机恢复；不代表重放未知 Effect。
- `terminateTask`：Task → TERMINATED；Task Observer 对该 Task 停止 business wake/resume。

---

# 7. Task Observer Query

## 7.1 getTaskDriveProjection

用途：为 Extension Task Observer 提供**足以确定下一步、但不复制 Task Store** 的 bounded projection。

概念请求：

```json
{"taskId":"task-001"}
```

概念响应：

```json
{
  "taskId": "task-001",
  "taskStatus": "ACTIVE",
  "taskVersion": 8,
  "terminal": false,
  "currentNode": {
    "nodeId": "node-dev",
    "status": "READY",
    "version": 2,
    "runNo": 1,
    "requiredAgentPackageRef": "@tomflow/proflow-agent-controller-dev"
  },
  "roleBinding": {
    "agentPackageRef": "@tomflow/proflow-agent-controller-dev",
    "roleRef": "g-dev",
    "workerRef": "c-dev-001",
    "conversationLocator": "https://chatgpt.com/..."
  },
  "canDrive": true,
  "blockedReason": null
}
```

Task Observer 还可以读取 Execution/Collaboration/Carrier 的 Public facts，但不得把这些事实复制进 Task Store。

正常 deterministic conditions（READY、Execution Result READY、Peer Reply READY、Reopen READY）不调用 FAST/REASON。异常诊断边界见 `TASK-DOC-03-05`。

---

# 8. Node API

## 8.1 getNodeContext

返回 fresh formal Task/Node facts 与 document metadata，默认不塞完整 Requirement/PRD 正文。

```json
{
  "task": {
    "taskId": "task-001",
    "status": "ACTIVE",
    "version": 8
  },
  "node": {
    "nodeId": "node-dev",
    "status": "READY",
    "version": 2,
    "runNo": 1,
    "requiredAgentPackageRef": "@tomflow/proflow-agent-controller-dev",
    "workerRef": null,
    "inputDocuments": ["REQUIREMENT"],
    "outputDocuments": ["TECHNICAL_DESIGN"]
  },
  "documents": [
    {
      "documentType": "REQUIREMENT",
      "documentRef": "taskdoc:req-001",
      "contentHash": "sha256:...",
      "sizeBytes": 12345
    }
  ]
}
```

Conversation memory 只辅助认知，不替代 fresh current reality。需要正文/文件时使用 TaskDocument/File Bridge；`openaiFileResponse` 属于 Gateway/OpenAI transport，不进入 Task business contract。

---

## 8.2 startNode

**Task Observer 不替 Worker 调 `startNode`。** Task Observer 先将 `NODE_READY` WAKE 投递给绑定 Worker；Worker 收到后通过正式 Action 调 `startNode`。

请求：

```json
{
  "taskId": "task-001",
  "nodeId": "node-dev",
  "expectedTaskVersion": 8,
  "expectedNodeVersion": 2,
  "actorRef": "worker:c-dev-001",
  "idempotencyKey": "idem:start-node-dev:run-1"
}
```

调用方**不得提供任意 workerRef**。Task 根据：

```text
Node.requiredAgentPackageRef
→ TaskRoleBinding(agentPackageRef)
→ workerRef
```

解析当前 Worker，并验证 actor/worker binding。

效果：`READY → IN_PROGRESS`；`Node.workerRef = bound workerRef`。

---

## 8.3 completeNode

仅 Task-bound current Worker/合法 Controller action 可以提交。Task 检查当前 run、版本和 required outputs。

成功：

```text
Node IN_PROGRESS → SUCCEEDED
下一 Node → READY
若最后 Node完成 → Task terminal success
```

Task 只产生 owner facts；下一 Worker WAKE 仍由 Task Observer 请求 Carrier。

---

## 8.4 waitNode

`waitNode` 只表达**真实 workflow/business blocker**。

v1 建议类型：

| 值 | 含义 |
|---|---|
| `BUSINESS_CONFIRMATION` | 业务事实缺失，需要人/Controller 做业务确认后才能继续 |
| `REQUIREMENT_BLOCKED` | Requirement/输入业务资料不足，Node 无法继续 |
| `EXTERNAL_BUSINESS_DEPENDENCY` | 外部业务依赖未满足，且确实需要 Task 层停止推进 |

以下事实**默认不得**通过 `waitNode` 映射成 Task WAITING：

```text
Execution QUEUED/RUNNING/WAITING_APPROVAL
Collaboration Message PENDING
Carrier page recovery pending
System Observer finding
```

这些继续归各 Owner；result/reply/recovery ready 后由 Observer 恢复同一 Worker Turn。

`waitNode` 成功可创建 Task-owned PendingMessage 用于真实 workflow confirmation，但不取代 Collaboration Message Center 或 Execution Approval。

---

## 8.5 failNode

`failNode` 是**业务 run 失败事实**，不是 Browser/transport transient failure 的默认映射。

只有当前 Node 的正式工作已经得到可信失败结论，且按 workflow 应进入 FAILED 时才使用。Carrier 恢复失败、Execution UNKNOWN 等先走各自 recovery/diagnostic，不得为了“技术链路出错”直接污染 Task truth。

---

## 8.6 reopenNode

效果：

```text
same taskId
same nodeId
same TaskRoleBinding
same workerRef
same Conversation
runNo + 1
目标 Node → READY
后续 Node 按 Frozen 规则重置 PENDING
```

**reopen 不把 workerRef 清空，也不创建新 Worker/Conversation。**

---

# 9. Task Document API

## 9.1 putTaskDocument

支持 Task-scoped 或 Node-scoped 文档。

PENDING requirement setup 示例：

```json
{
  "taskId": "task-001",
  "nodeId": null,
  "documentType": "REQUIREMENT",
  "content": "# Requirement\n...",
  "expectedTaskVersion": 3,
  "actorRef": "worker:c-product-001",
  "idempotencyKey": "idem:requirement-task-001-v1"
}
```

Node 正式输出示例可带 `nodeId`。

TaskDocument 仍是真源；Conversation File 不是 TaskDocument。

如果 GPT 使用 `openaiFileIdRefs` 提交文件：

```text
Conversation file
→ Gateway transport normalization
→ Execution bounded fetch/materialize/hash/MIME/size/scope
→ canonical TaskDocument content / controlled artifact reference
```

Task API 不持久化 OpenAI `download_link` 或 file id 作为业务 identity。

## 9.2 getTaskDocument

可按 `taskId + documentType (+ nodeId/version)` 读取正式文档；普通 Worker 优先通过 `getNodeContext` 获取 metadata，再按需取正文/File Bridge，避免大 Context 默认 JSON 注入。

---

# 10. Task Message / Event API

## 10.1 listPendingMessages / acknowledgeMessage

这里的 Task PendingMessage 只服务**Task-owned workflow confirmation**，不承担 Agent Collaboration `askPeer/replyPeer`、Execution Approval 或 Carrier delivery。

`acknowledgeMessage` 只记录 human/business confirmation，不自动 complete/reopen/重放 Effect。

## 10.2 listTaskEvents

返回 Task Owner 事件（Task/Node/TaskDocument/binding 等）。不得把 Browser logs、System Assessment 或 Collaboration logical events伪装成 TaskEvent。

---

# 11. 核心错误码 v0.2

至少稳定覆盖：

```text
TASK_GROUP_NOT_FOUND
TASK_NOT_FOUND
NODE_NOT_FOUND
MESSAGE_NOT_FOUND

TASK_INVALID_STATE
NODE_INVALID_STATE
TASK_GROUP_INVALID_STATE

TASK_VERSION_CONFLICT
NODE_VERSION_CONFLICT
TASK_GROUP_VERSION_CONFLICT

IDEMPOTENCY_CONFLICT

NODE_OUTPUT_MISSING
WORKER_MISMATCH
AGENT_PACKAGE_NOT_ELIGIBLE
ROLE_BINDING_MISMATCH
TASK_ROLE_BINDING_REQUIRED
TASK_ROLE_BINDING_NOT_FOUND
TASK_ROLE_BINDING_CONFLICT

DOCUMENT_TYPE_NOT_ALLOWED
DOCUMENT_NOT_FOUND
DOCUMENT_WRITE_FAILED
DOCUMENT_INDEX_MISMATCH

TASK_NOT_READY
TASK_BLOCKED
PREDECESSOR_NOT_SUCCEEDED
```

历史实现若仍公开 `TASK_NOT_AUTHORIZED/ROLE_NOT_ELIGIBLE`，Batch4 可通过兼容层迁移，但新规范不再把 authorization record 或 g-id `roleRef` 当 logical eligibility truth。

---

# 12. 明确不存在的 API / 事实

v1 没有：

```text
authorizeTask
createWorkItem
claimWork
releaseClaim
reassignWorker
assignWorker
createEdge
transitionNode
approveNode
retryWorkItem
cancelWorkItem
submitPlan
activatePlan
```

也没有：

```text
Task Approval Entity
Task APPROVAL_PENDING
Task persistent tab/frame identity
Task-owned Collaboration queue
Task-owned Execution wait state mirror
```

---

# 13. 当前 Task Public Contract 强约束

1. `createTask` 由 Extension/platform-host 发起，初始状态 `PENDING`；不是 Product GPT pre-Task Action。
2. `PENDING → READY` 是 deterministic readiness：Requirement + 三个 required Worker bindings + TaskGroup prerequisite（若有）。不依赖 `authorizeTask/authorizedByRef`。
3. Human “批准并开始”只是 v1 Extension channel；确认后调用 `startTask`，未来 Feishu 可替换 UI channel而不改变 Task Contract。
4. TaskRoleBinding stable key = `(taskId, agentPackageRef)`，内容 = `agentPackageRef + roleRef + workerRef + conversationLocator`；不持久化 tab/frame。
5. `Node.requiredAgentPackageRef` 表示逻辑岗位；`roleRef` 只表示实际 Custom GPT deployment identity。
6. `startTask` 只把 READY Task 变 ACTIVE并将首个 business Node 变 READY；Task 不操作 Browser。
7. Task Observer 看到 READY 后先 RESTORE/WAKE；Worker 再正式调用 `startNode`。
8. `startNode` 不接受调用方指定 workerRef；Task 通过 `requiredAgentPackageRef → TaskRoleBinding.workerRef` 解析。
9. Execution/Collaboration/Carrier 的异步 pending 默认不改 Task WAITING；只有真实 workflow blocker 才用 `waitNode`。
10. Reopen 复用原 TaskRoleBinding/Worker/Conversation，runNo+1。
11. 所有 Public Command 遵守 runtime validation、Owner-domain idempotency、必要 expectedVersion 与统一 error envelope。
12. Gateway/Browser/Execution/Observer 不得直接写 Task SQLite；所有 workflow transition 必须回到 Task Public Command。

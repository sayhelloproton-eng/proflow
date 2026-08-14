---
docId: EXECUTION-EXECUTION-BROWSER-EXTENSION-TECH-DESIGN
title: 04 · execution-browser-extension 详细技术方案
docType: module-design
authority: normative
lifecycle: active
domain: execution
moduleRef: execution-browser-extension
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- EXECUTION-DOC-02-01
- EXECUTION-DOC-02-02
- PLATFORM-DOC-01-04
- TASK-DOC-03-05
- MODEL-DOC-03-08
---

# 04 · execution-browser-extension 详细技术方案

> 2026-08-14 对齐：Extension 不再被描述为一个“Task Driver 万能调度器”。同一 package 内明确分离 Task UI / Approval-Alert UI / Task Observer / System Observer / Background Carrier Controller。Browser Carrier 降为可靠页面载体；Task progression 与 system assessment 分开。

---

## 1. 定位

Browser Extension 完全归 Execution Domain 的 Browser capability，但内部可以组合 Application components。

它负责：

```text
Task UI / New Task入口（application composition）
Approval/Alert UI（interaction channel）
Task Observer（deterministic progression detection）
System Observer（lowest-priority whole-system assessment coordination）
Background Carrier Controller（real page operations）
P0 Side Panel
Browser Effect / Evidence
```

它不是：

```text
Task/Agent/Deployment business owner
通用 Scheduler/Event Bus
Approval business service
File Store
Agent Runtime
```

---

## 2. 顶层逻辑结构

概念结构：

```text
extension/
├── ui/
│   ├── task-list-new-task
│   ├── approval-alert
│   └── side-panel
├── background/
│   ├── runtime-session
│   ├── task-observer
│   ├── system-observer
│   ├── carrier-controller
│   ├── recovery
│   └── evidence-log-client
├── content/
│   ├── chatgpt-page-adapter
│   ├── deterministic-dom-observer
│   └── screenshot-capture
└── shared/
```

物理目录不要求完全一致，但职责不得重新合并成一个“万能 task-driver”。

---

## 3. New Task / J1

Extension 是 v1 唯一 New Task 入口：

```text
user New Task
→ Task createTask(PENDING)
→ fixed Product/Dev/Test agentPackageRefs
→ resolve current roleRefs
→ Carrier CREATE 3 Conversations（可并发）
→ observe workerRef/c-id + conversationLocator
→ Task bindTaskWorker × 3
→ Product 一经绑定即可 requirement discussion
→ Dev/Test WORKER_BIND + IDLE
→ Product formalizes REQUIREMENT
→ Task deterministic READY
```

### 3.1 Partial success

```text
Product bound / Dev bound / Test missing
→ keep two successful bindings
→ only retry/recover Test
```

不得失败就重建全部 Conversations。

### 3.2 Create Effect uncertainty

如果 submit/bootstrap 后断联，不能直接 CREATE 第二个 Conversation：

```text
re-observe current tabs/role page/navigation
→ confirm existing conversation / confirm absent / UNKNOWN
```

---

## 4. Stable vs transient identity

Stable business/carrier identity：

```text
agentPackageRef/packageName
roleRef/g-id
workerRef/c-id
conversationLocator
```

Transient：

```text
tabId
windowId
extensionInstanceId
contentInstanceId
attemptNo
```

Task 不持久化 transient browser identity。

Worker Lane 如保留，只是 runtime view，建议 key 至少包含：

```text
taskId + agentPackageRef + workerRef
```

不是新 Entity/Store。

---

## 5. Background Carrier Controller

唯一负责 typed Browser operations：

```text
CREATE_CONVERSATION
OPEN_OR_RESTORE_CONVERSATION
WAKE_WORKER
DELIVER_COLLABORATION
CAPTURE_SCREENSHOT
OBSERVE_PAGE
RECOVER_DELIVERY
```

UI/Observer 只请求 typed operation；不能直接散落调用 Chrome DOM primitives。

---

## 6. Content Script / DOM strategy

真实 DOM 操作通过受控 Content Script 或 `chrome.scripting.executeScript()`：

```text
scroll to bottom
locate composer
programmatic input
submit
observe deterministic success/failure indicators
```

第一版禁止依赖：

```text
mouse coordinates
keyboard coordinates
frame registry
frame-role handshake
iframe workspace
complex tab/frame topology
```

DOM first；只有 deterministic DOM 无法解释页面时：

```text
screenshot
→ Model Vision
→ structured observation
```

Vision 结果只辅助 Carrier判断，不成为 Task/Execution business success。

---

## 7. CREATE

前置：对应 TaskRoleBinding 还没有 workerRef。

```text
open registered Role URL
→ page ready
→ minimal Product requirement-start or Dev/Test WORKER_BIND message
→ observe Conversation navigation / c-id
→ verify role/c-id
→ capture conversationLocator
→ report/bind via Task Public Contract
```

CREATE 成功 ≠ Task binding 成功；两层事实分别由 Browser/Task持有。

---

## 8. RESTORE

前置：已有 workerRef + conversationLocator。

```text
if correct current tab exists → focus/reuse
else open conversationLocator
→ wait page ready
→ observe c-id/role consistency
→ establish transient content session
```

缺 Tab 永远不是 CREATE 条件。

---

## 9. WAKE

```text
RESTORE
→ verify correct writable Conversation
→ build minimal trigger
→ scroll/input/submit
→ verify physical trigger present
```

Minimal trigger：

```text
taskId
nodeId? / runNo?
workerRef
triggerType
underlying execution/message/reopen ref when relevant
```

不默认注入 Requirement/PRD/代码/长日志。

WAKE success 只证明 physical delivery。

---

## 10. Node READY 顺序

冻结：

```text
Task Node READY
→ Task Observer request WAKE
→ Browser delivers NODE_READY
→ Worker calls Task.startNode
→ Task verifies binding/version/runNo
→ Node IN_PROGRESS
```

不再采用“Task Driver 先 startNode 再通知 Worker”作为默认语义，也不允许 Browser自己修改 Node状态。

---

## 11. Worker Turn / Multi-action

一次 WAKE 启动一个 Worker Turn；GPT 可以在同一 Turn 内：

```text
reason
→ Action
→ result
→ Action
→ ...
```

Browser 不：

```text
每 Action 再 WAKE
自动输入“继续”
抓 GPT reply 做 Task状态判断
建立 WorkerTurn Store/Runtime
```

长 Execution / Approval / cross-worker peer wait 是 Turn boundary，结果 ready 后 Task Observer 再 WAKE同一 Worker。

---

## 12. Task Observer

Task Observer 是 concrete Task progression detector。

### 输入

```text
Task drive projection
TaskRoleBinding
relevant Execution Result readiness
relevant Collaboration reply/delivery readiness
last Carrier wake result
terminal flag
```

### 正常 deterministic outputs

```text
NODE_READY → WAKE current Worker
EXECUTION_RESULT_READY → RESUME same Worker
PEER_REPLY_READY → RESUME same Worker
REOPEN READY → WAKE original Worker
```

规则能判定就不调用模型。

### REASON 例外

只有：

```text
conflicting facts
Execution/Delivery UNKNOWN
repeated recovery failure
unexplained stalled
multi-signal prioritization
```

才请求 Task Diagnostic REASON。模型只能给 finding/recommendation，不可 complete/reopen/approve/replay Effect。

---

## 13. System Observer

System Observer 是**整个系统评估器**，不是全局待办处理器。

读取 bounded views：

```text
Task
Agent/Worker
Collaboration
Execution
Carrier
Model
Deployment/Services
Logs/Artifacts/Evidence summaries
```

通过 Model Runtime执行：

```text
compact snapshot
→ concern batches
→ carry-forward/drill-down
→ global REASON synthesis
→ System Assessment
```

它最低优先级；手机模型忙/业务 lane忙时 defer。输出仅 assessment/findings/risks/recommendations/typed request，不直接改变 Owner facts。

详细合同见 `EXECUTION-DOC-03-04` 与 `MODEL-DOC-03-08`。

---

## 14. GPT Action Permission

Routine platform query/control/intent Actions：

```text
x-openai-isConsequential:false
→ user initial Always Allow
→ happy path no per-action Browser permission click
```

unexpected permission prompt / changed schema-domain-auth / truly consequential external UI case 才进入 recovery/human path。

OpenAI confirmation ≠ Execution Effect Approval。

---

## 15. Human Decision / Approval UI

Extension UI 可承接：

```text
Task start confirmation
Execution Approval
System alerts
Deployment ACTION_REQUIRED guidance
```

但正式结果仍提交给对应 Owner；UI不是 Approval/Task/Deployment真源。Future Feishu 可替换/并存 interaction channel。

---

## 16. Collaboration physical delivery

Agent Message Center owns logical message。

```text
pending message
→ resolve target TaskRoleBinding
→ RESTORE target Conversation
→ submit
→ verify physical delivery
→ Execution Evidence/Result
→ Agent updates logical delivery fact
```

同一个 messageRef 不得 blind duplicate delivery。

---

## 17. Browser Effect durability / UNKNOWN

Browser real write 应尽量复用 Execution durable record/stage：

```text
COMMAND_ACCEPTED
PRECONDITION_VERIFIED
EFFECT_STARTED
RESULT_REPORTED
```

不新增第二套 BrowserOperation business DB / Attempt Entity tree。

`EFFECT_STARTED` 后失联：

```text
UNKNOWN
→ reopen/observe current reality
→ delivered / absent / still unknown
```

no blind replay。

---

## 18. File Bridge / Context Pack

普通文件不由 Browser DOM 搬运。

```text
Conversation → openaiFileIdRefs → Gateway → Execution materialize
Task/Execution Artifact → Gateway openaiFileResponse → Conversation
```

Context Pack / Patch 都是 Execution Artifact subtype。

截图因 OpenAI image return asymmetry继续走 Browser/Execution → Model Vision。

---

## 19. Page runtime / recovery

Page runtime 可表达：

```text
IDLE / BUSY / BLOCKED / UNKNOWN
```

但不是业务状态机。

Recovery：

```text
extension reload/reconnect
→ discover current tabs
→ rebuild transient sessions
→ query durable unfinished Browser Executions
→ reconcile real page state
→ safely resume
```

Task terminal 时 Task Observer stop-driving；历史页面可人工打开，但不主动业务 WAKE。

---

## 20. Side Panel / logging

Side Panel 是 current reality/assessment/alert入口。Structured logs 按统一 correlation轴持久化，禁止 raw credential/full prompt/full file/screenshot binary。详见 `EXECUTION-DOC-03-04`。

---

## 21. 明确不建设

```text
Frame Registry / frame handshake
Iframe team workspace
persistent tab identity
Browser Task/Message/Artifact business Store
Browser File Manager
Action-level scheduler
Browser natural-language Task progression
universal Observer/Scheduler
second durable Effect runtime
```

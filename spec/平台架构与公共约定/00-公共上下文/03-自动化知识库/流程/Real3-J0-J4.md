# Flow｜Real-3 J0→J4 人工视角自动化验收

> 当前 Phase 3 主线。基础设施/包修复只作为本流程中的可恢复子流程，不得反向重开 Deployment。

## Journey

```text
J0  3 Role/GPT 已可用于真实 Task
J1  New Task → PENDING → Product/Dev/Test Worker + Conversation Binding → Product 需求沟通
J2  用户确认 → startTask → 前置条件校验 → first Node READY
J3  READY Node → Observer → Locate Worker/Conversation → Restore → WAKE 真正提交
J4  Worker 收到 WAKE → 自主 Worker Turn → Reason → Action/Owner API/Execution → Result
```

## 三条铁语义

```text
Role != Worker
WAKE success != Node success
Browser API call success != message truly submitted
```

Role 可以服务多个 Task；每个 Task 有独立 Worker identity。Node 必须绑定 canonical workerRef，不能让 Browser/Observer 临时猜 Worker。

J3 的 WAKE 必须在正确真实 Conversation 中出现 user message 结构证据；只收到 API `ok` 不能 PASS。

## 自动化执行顺序

前置平台只要求当前 Journey 真正需要的能力 READY；不要为了 Real-3 再跑完整 Deployment。开始前按 CURRENT 处理实际 blocker，随后：

1. `platform start`，确认命令归还 shell；`platform status` 观察当前现实。
2. J0：真实 3 Role/GPT readiness，与 owner-local identity 对齐。
3. J1：通过正式 New Task 入口创建 PENDING Task；证明 Product/Dev/Test Worker 与 Conversation binding 持久存在；部分失败只补缺失项。
4. J2：由真实用户确认触发正式 `startTask`；证明 Requirement/bindings/prerequisite 通过，first Node READY、Task ACTIVE。
5. J3：Observer 从 READY Node 的 canonical workerRef 定位 Worker/Conversation → Restore → WAKE；由 Browser Runbook 做真实 submit 结构证明。
6. J4：证明 Worker 收到 WAKE 后自主进入 Worker Turn，读取 Task/Node/Requirement/Context，经 Reason → Action/Owner API/Execution → Result；Browser 不反复“点继续”驱动 Agent Loop。

每个 J 完成即保存 Owner Facts + Browser evidence，作为下一 checkpoint；后续失败从最近已证明 checkpoint 恢复，不机械从 J0 重来。

## 真实执行入口与 Authority

真人入口是 **ProFlow Execution Browser Extension Side Panel**，不是直接写 Task DB/`.proflow`。Side Panel 通过 `PROFLOW_TASK_APPLICATION` 调产品物化的 Task Application；Background 使用 managed runtime config 中的 endpoint/token 调 `POST <endpoint>/application/task`。endpoint/token 由产品 setup/materialization 生成，禁止手填、复制或在 Runbook 写死。

稳定 Side Panel 操作：

```text
task.list / task.get        = 读取 Task Owner facts
task.create                 = New Task
task.ensureWorkers          = 只补缺失 Worker/Conversation binding
task.start                  = 用户确认后的正式 Start
node.reopen                 = 显式 reopen，不隐式重跑
```

### J1｜New Task / Worker / Requirement

`task.create` 创建 Task Owner 的 `PENDING` Task + 固定 Product/Dev/Test role bindings；binding 初始 `workerRef=null / conversationLocator=null`。Platform Host 随后并发执行三个 durable `worker.create`：Product Worker 完成后即可返回进入需求沟通，Dev/Test 在后台继续；失败后 `task.ensureWorkers` 只补缺失 binding，不重建已有 Worker。

`worker.create` 的真实 Browser 合同：打开 Role URL → 提交 `WORKER_BIND <bootstrapFingerprint>` → `browser.hasMessage` 确认真实 user message → 从真实 `/g/<roleRef>/c/<workerRef>` URL 取得 Worker identity → 写回 Task Owner 的 `workerRef + conversationLocator`。API success、Tab 打开或旧 evidence 都不能替代这四步。

Product Worker 在已绑定的 PENDING Task Conversation 中澄清需求；**Product GPT 不创建 Task、不动态发现 Role，也不从聊天 UI 猜 Task 状态**。正式 Requirement 写入唯一走 Product Custom GPT Action：

```text
POST /actions/putTaskDocument
operationId = putTaskDocument
documentType = REQUIREMENT
taskId + expectedTaskVersion + idempotencyKey
content 或受控 openaiFileIdRefs
```

Conversation 文件/Web Search/Code Interpreter 只用于认知；正式 Task facts/document 必须回 Owner Actions。Task 只有在 `REQUIREMENT` 文件及 hash 有效、固定三个 binding 全部有 workerRef+conversationLocator、Node role 合法等 prerequisite 全部满足后，才由 Task Owner `PENDING → READY`。

### J2｜用户确认 / Start

用户确认后点击 Side Panel Start，公开入口为 `task.start`，内部进入 Task Owner `startTask`。必须使用当前 Task version；Task 非 READY 或 prerequisite 再检查失败都应 fail closed。

成功真值严格是：

```text
before: Task READY
→ task.start
→ Task ACTIVE
→ first Node READY
→ currentNodeId = first Node
```

只看到按钮点击/HTTP 2xx 不能判 J2 PASS，必须回读 Task/Node Owner facts。

### J3｜Observer / Restore / WAKE

Browser Extension Task Observer 通过 `/application/observer` 读取 `task.projection`；projection 的 current Node 与 `roleRef/workerRef/conversationLocator` 是 canonical Owner facts。`BINDING_NOT_READY` 时禁止临时猜 Conversation。

READY Node 产生 `WAKE`：首次 run 用 `NODE_READY`，reopen run 用 `REOPEN`。Observer carrier 调 `task.wake`；Execution Browser 先 `worker.restore`/`ensureRestored` 到持久 conversationLocator，要求 URL 中 roleRef/workerRef 与 Task binding 完全一致，再提交 `proflow.agent.browser-trigger.v1` trigger。

WAKE 后必须用真实 `browser.hasMessage(fingerprint)` 确认 user message；否则 `WAKE_REALITY_UNCONFIRMED / UNKNOWN_SIDE_EFFECT`，不得重发。`WAKE delivered != Node success`。

### J4｜Worker Turn / Action / Result

Worker 收到真实 WAKE 后应在**同一个 Worker Turn**自主读取 Task/Node/Requirement/context，并可连续调用多个正式 Actions；禁止 Browser 在每个 Action 后发送“continue”来人工驱动 Agent Loop。

Task/Collaboration facts 以 Platform Host/Task Owner 为准；真实机器或外部副作用以 Execution Owner 为准。J4 PASS 需要看到 Worker 真实 Action/Owner API/Execution 结果与 Task/Node 后续 Owner facts 一致；Conversation 文本、WAKE success 或单个 Action HTTP 2xx 都不足以判完成。

### 恢复路径

Extension startup/event recovery 会遍历非终态 Task：先执行幂等 `task.ensureWorkers` 补缺失 binding，再 `taskObserver.drive(taskId)`；durable Execution/Task binding 是恢复 authority，不依赖旧内存 Promise。Execution side effect 为 UNKNOWN 时遵守 no-blind-replay，先读 durable execution/evidence，再决定恢复。

## 失败路由

若失败属于具体包：保存 Journey checkpoint → 对应 `包能力` Runbook → `Package-Update-Loop` → 原 checkpoint 重放。已证明的 J 不因无关包修复重新跑。

若只能通过改 Frozen Contract 才能继续：STOP，由总控进入 SPEC_GAP/CONTRACT_CONFLICT，不让自动化偷偷绕过去。

## PASS

只有 J0～J4 全部有真实产品路径证据，Browser 真提交与 Owner Facts 一致，才允许 `REAL_3=PASS`。源码/测试映射、单测 PASS、WAKE API success 均不能单独替代真实 Journey。

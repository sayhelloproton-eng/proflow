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

## 人工模拟验收 Harness

固定节奏：`ACT → OBSERVE → OWNER READBACK → CHECKPOINT`。用户可见入口必须使用真实 CLI / Chrome / 插件拥有的独立 `ProFlow Tasks` 页面 / ChatGPT Conversation；内部 API、直接改 `.proflow`、Task DB 或伪造 Browser evidence 只能用于工程诊断，不能替代 PASS。

生命周期前置 Gate 只需证明一次：`platform start` 归还 shell → owned runtime process 出现 → `platform stop` 成功 → 同一 owned process 消失 → 再 `platform start` → `platform status = PLATFORM_READY=YES`。通过后标记 `L0_LIFECYCLE=PASS`，Real-3 后续不得为了“保险”重复 stop/start。

每个 Journey 的证据固定为两类：①真人视角证据：CLI 输出、`ProFlow Tasks` 页面可见状态、ChatGPT DOM/URL/真实 user message；②Authority 证据：Task/Node/Worker/Role/Execution Owner facts。两类必须一致，任何一类缺失都只能记为 checkpoint 未完成。

失败恢复固定为：保存当前可见页面与 Owner facts → 定位 owning package/owner boundary → 最小修复 → targeted gate / package update（如需要）→ 返回原 Journey checkpoint。已经证明的 L0/J0/J1... 不因无关修复重跑；禁止 Fresh、重复创建 GPT、重复创建已有 Worker/Conversation 或 blind replay 外部副作用。

Real-3 已处于真实自动化测试阶段，repair loop 额外遵守 **Minimum-Impact / Iterative Validation**：一次只修一个已证明的行为缺陷，不把“可选架构优化”捆进当前 blocker；每次修改后先跑 owning package 的 targeted regression，再回到同一个 J checkpoint 做真人视角 + Owner readback。若当前 Promise / Owner truth / idempotency / recovery composition 足以表达正确行为，禁止为了方便新增 Queue、Message、Scheduler、Framework 或修改 Frozen/Public Contract。只有最小修复经同场景验证仍不足，并出现新的机械证据，才进入下一轮候选问题。

系统 UI 与业务 UI 分工：ChatGPT Conversation 以及可被 debugger attach 的 `ProFlow Tasks` 普通 Web surface 统一用 Playwright，并默认后台运行；Chrome 扩展工具栏、`chrome://extensions`、Load unpacked、系统 picker/确认框等 privileged UI 复用仓库唯一 AX/Swift human-E2E helper。若某个 `chrome-extension://...` 页面被机械证明因 Chrome 跨扩展限制无法由 Playwright attach，仍可用 AX tree + 系统截图作为真人“眼睛和手”进行分析、诊断和点击，不能把“不可调试”误判成“不可自动化”。AX helper 默认不得 activate Chrome，只有 privileged/不可 attach 临界动作才允许短暂激活；每次 mutation 后仍必须回 Owner authority。

Real-3 的 Playwright controlled group 固定视为一个业务工作集：`ProFlow Tasks + Product/Dev/Test-Ops 三个真实 Worker Conversation`。J1 创建 Conversation 后立即把原 Conversation Tab 纳入同组；不预先打开三个 Role 根页，不复制打开第二份 Conversation。完成纳管后，J1→J4 的普通页面 ACT/OBSERVE 均在该组内后台完成，AX 只负责 group attach 或其它 Chrome privileged 临界动作。

## 真实执行入口与 Authority

真人入口是 **ProFlow Execution Browser 插件拥有的独立 `ProFlow Tasks` 页面**，不是直接写 Task DB/`.proflow`，也不再使用 Side Panel。主路径优先使用插件 owning package 提供的 loopback Web surface，使 Playwright 能后台 attach；若 bridge 不可用而回退到 `chrome-extension://...` 页面，则按“Playwright 不可 attach、AX/截图仍可作为眼睛和手”的边界处理。Task/Approval 最终仍通过既有 authenticated owner application 进入 Platform Host；endpoint/token 由产品 setup/materialization 生成，禁止手填、复制或暴露到页面。

稳定 `ProFlow Tasks` 页面操作：

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

用户确认后在 `ProFlow Tasks` 页面点击 Start，公开入口为 `task.start`，内部进入 Task Owner `startTask`。必须使用当前 Task version；Task 非 READY 或 prerequisite 再检查失败都应 fail closed。

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

## 2026-09-03｜J1 Browser Reality 增量约束

- 当前 Real-3 Tasks 主路径已验证为 `http://127.0.0.1:<bridge>/tasks`。Acceptance 必须使用 Extension action 打开的原始 Tasks Tab，并把该 Tab 纳入 Playwright controlled group；禁止复制第二个 `/tasks` Tab。
- Extension action 是恢复语义的一部分：每次打开/恢复 Tasks 都必须真实 mint 新 Web session；Human-E2E helper 不得用“页面已存在”替代本次 action。Harness 假成功不算真人入口证据。
- Tasks Web session 仍由 owning Browser package 控制，Platform Host bearer token 仅留在 Node composition；页面只持有 HttpOnly loopback session。不可为了 Playwright 放宽 Owner token 边界。
- `worker.create` mutation 前必须保存 Task / bindings / stable Execution baseline。只有 `FAILED + NOT_APPLIED` 且无 Browser effect 才允许执行一次 `Recover missing Workers`；任何 UNKNOWN/EFFECT_STARTED 先 reconciliation，禁止 blind replay。
- Recover 后先 OBSERVE 浏览器原创建 Tab，再 OWNER READBACK；新 Worker Conversation 一出现即纳入 controlled group，且只纳管原 Tab。

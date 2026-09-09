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

Real-3 的 Browser 执行只保留流程级约束：业务工作集固定为 `ProFlow Tasks + Product/Dev/Test-Ops 三个真实 Worker Conversation`，纳管原 Tab、禁止复制第二份 Conversation。普通 Web/privileged UI 的工具分工、controlled-group attach、跨扩展限制、焦点/截图纪律统一由 `基础动作/Browser-UI自动化.md` 与 `基础动作/Tool-Runtime-gptweb-mcp.md` 拥有。

## 真实执行入口与 Authority

真人入口是 **ProFlow Execution Browser 插件拥有的独立 `ProFlow Tasks` 页面**，不是直接写 Task DB/`.proflow`，也不再使用 Side Panel。主路径优先使用插件 owning package 提供的 loopback Web surface，使 Playwright 能后台 attach；若 bridge 不可用而回退到 `chrome-extension://...` 页面，则按“Playwright 不可 attach、AX/截图仍可作为眼睛和手”的边界处理。Task/Approval 最终仍通过既有 authenticated owner application 进入 Platform Host；endpoint/token 由产品 setup/materialization 生成，禁止手填、复制或暴露到页面。

稳定 `ProFlow Tasks` 页面操作：

```text
task.list / task.get        = 读取 Task Owner facts
task.create                 = New Task
task.start                  = 用户确认后的正式 Start
node.reopen                 = 显式 reopen，不隐式重跑
backend Reconciliation      = 自动补缺失 Worker/Conversation binding + bounded catch-up
```

### J1｜New Task / Worker / Requirement

`task.create` 创建 Task Owner 的 `PENDING` Task + 固定 Product/Dev/Test role bindings；binding 初始 `workerRef=null / conversationLocator=null`。Platform Host 随后并发执行三个 durable `worker.create`：Product Worker 完成后即可返回进入需求沟通，Dev/Test 在后台继续；若创建或绑定中途失败，backend Reconciliation 会从 Task Owner durable facts 重新发现缺失 binding，并只补缺失 Worker/Conversation，不重建已经成功的 Worker。

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

backend Task Observer/Reconciliation 读取 `task.projection` 与其它 Owner current facts；projection 的 current Node 与 `roleRef/workerRef/conversationLocator` 是 canonical Owner facts。`BINDING_NOT_READY` 时禁止临时猜 Conversation。页面 event、Extension reconnect/startup 只提供低延迟 kick，不能成为唯一 progression source。

READY Node 产生 typed Carrier request：首次 run 用 `NODE_READY`，reopen run 用 `REOPEN`。Browser Extension 只负责 restore/permission/submit/receipt/page reality：先恢复到持久 `conversationLocator`，要求 URL 中 roleRef/workerRef 与 Task binding 完全一致，再提交 `proflow.agent.browser-trigger.v1` trigger。WAKE 后必须用真实 `browser.hasMessage(fingerprint)` 确认 user message；否则 `WAKE_REALITY_UNCONFIRMED / UNKNOWN_SIDE_EFFECT`，不得重发。`WAKE delivered != Node success`。

### J4｜Worker Turn / Action / Result

Worker 收到真实 WAKE 后应在**同一个 Worker Turn**自主读取 Task/Node/Requirement/context，并可连续调用多个正式 Actions；禁止 Browser 在每个 Action 后发送“continue”来人工驱动 Agent Loop。

Worker 只需要理解 `Task / Node / Document / Peer / Tools`。Task/Node/Document/Peer 事实走 Owner Public Contract；本机工程现场使用 Repomix / Local Dev / CodeGraph，物理链统一为 `Action → Gateway → ProFlow API → Browser Extension 独立 Local Tool lane → execution-local → macOS`。Direct Tool 不进入 `executeCapability/getExecution/readExecutionOutput` lifecycle，Tool result 也不会自动推进 Node；Worker 必须显式调用 Task command。

### 恢复路径

backend Reconciliation 对非终态 Task 做 bounded catch-up，并从 durable Owner facts 重新发现 READY/REOPEN/RECOVERY_RESUME；Extension startup/event/reconnect 只加速。Browser/Carrier 内部 durable Effect 若为 UNKNOWN 继续遵守 no-blind-replay，先观察 durable Execution/页面 reality；Direct Local Tool mutation 若结果不确定，则通过 file/Git/process/port reality 再观察，不创建 Execution polling。

## 失败路由

若失败属于具体包：保存 Journey checkpoint → 对应 `包能力` Runbook → `Package-Update-Loop` → 原 checkpoint 重放。已证明的 J 不因无关包修复重新跑。

若只能通过改 Frozen Contract 才能继续：STOP，由总控进入 SPEC_GAP/CONTRACT_CONFLICT，不让自动化偷偷绕过去。

## PASS

只有 J0～J4 全部有真实产品路径证据，Browser 真提交与 Owner Facts 一致，才允许 `REAL_3=PASS`。源码/测试映射、单测 PASS、WAKE API success 均不能单独替代真实 Journey。

## Browser 执行知识归属

Real-3 只拥有 Journey 与 checkpoint；Tasks loopback page、原 Tab 纳管、controlled group、Playwright attach/跨扩展限制、Extension action/session 等已经稳定的 Browser 机械知识统一维护在 `基础动作/Browser-UI自动化.md`、`基础动作/Tool-Runtime-gptweb-mcp.md` 与 `包能力/execution-browser-extension.md`。流程文件不再复制这些 SOP。

## 2026-09-09 独立审计后的验证分界

执行前读取当前 `AGENT-DOC-02-05` §9–11 与 Extension Technical Design §23–24：Host enqueue credential 不可执行 Tool；Bridge 独立 lifecycle + Provider child 隔离；backend catch-up 必须测试分页/丢事件/重复事件/terminal race。

F9 已由 trusted local command 权限裁决关闭，当前进入分 Wave 源码实现；shipped Actions 与部署采用状态仍以真实证据为准。固定混合 Local Dev Action consequential=true，read 也会提示确认；不能把这类预期确认当作 permission blocker 自动消除。获准的 test/build/install 继承 OS 用户权限；明确可识别的 Workspace 越界先提示用户、无需批准，不把 argv/cwd 当 sandbox，也不要求 OS sandbox 才开工。

记录 DESIGN_AUDIT、SOURCE_IMPLEMENTATION、PROVIDER_REALITY、REAL_3 四种结果。test-governance 在 testcase 重绑前可报告 stale/unmapped，保持原报告并在正式实现后更新；禁止现在生成 08 evidence 来造 PASS。

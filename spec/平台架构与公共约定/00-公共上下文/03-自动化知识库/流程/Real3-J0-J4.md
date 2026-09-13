# Flow｜Real-3 J0→J4 人工视角产品验收

> 当前 Phase 3 主线。本文件只拥有 **Real-3 的产品 Journey、identity、checkpoint、Owner facts、PASS/FAIL/STOP 条件**；ChatGPT Chat 如何操作 Browser/CLI/PTTY/MCP、如何恢复/等待/验证，统一由 `/Users/agent/Desktop/proton-workspace/skills/chat-local-acceptance-automation-protocol/SKILL.md` 决定。涉及源码修复时统一切 `/Users/agent/Desktop/proton-workspace/skills/chat-local-engineering-protocol/SKILL.md`。

## Journey

```text
J0  3 Role/GPT 已可用于真实 Task
J1  New Task → PENDING → Product/Dev/Test Worker + Conversation Binding → Product 需求沟通
J2  用户确认 → startTask → 前置条件校验 → first Node READY
J3  READY Node → Observer → Locate Worker/Conversation → Restore → WAKE 真正提交
J4  Worker 收到 WAKE → 自主 Worker Turn → Reason → Action/Owner API/Execution → Result
```

## 三条产品铁语义

```text
Role != Worker
WAKE success != Node success
Browser API call success != message truly submitted
```

Role 可以服务多个 Task；每个 Task 有独立 Worker identity。Node 必须绑定 canonical `workerRef`，不能让 Browser/Observer 临时猜 Worker。

J3 的 WAKE 必须在正确真实 Conversation 中出现 user message 结构证据；只收到 API `ok` 不能 PASS。

## J0→J4 产品顺序

前置平台只要求当前 Journey 真正需要的产品能力 READY；不要为了 Real-3 重开已经冻结的完整 Deployment。

1. **J0**：真实 3 Role/GPT readiness，与 owner-local identity 对齐。
2. **J1**：通过正式 New Task 入口创建 PENDING Task；证明 Product/Dev/Test Worker 与 Conversation binding 持久存在；部分失败只允许按产品 contract 补缺失 binding。
3. **J2**：真实用户确认后走正式 `startTask`；Requirement/bindings/prerequisite 通过，first Node READY、Task ACTIVE。
4. **J3**：Observer 从 READY Node 的 canonical `workerRef` 定位持久 Worker/Conversation，进入 Restore → WAKE；必须证明真实 user message 已提交。
5. **J4**：Worker 收到 WAKE 后在同一个 Worker Turn 自主读取 Task/Node/Requirement/Context，经 Reason → Action/Owner API/Execution → Result；Browser 不作为逐 Action 的 Agent Loop 驱动器。

每个 J 的产品 checkpoint 由 Owner facts + 真人路径 evidence 共同证明。后续自动化如何保存/恢复 checkpoint、如何选择 SAME_SCENE/FAST_REPLAY/FULL_FRESH，全部服从 Acceptance Skill，不在本 Flow 复制方法。

## 真实产品入口与证据

真人入口是 **ProFlow Execution Browser 插件拥有的独立 `ProFlow Tasks` 页面**，不是直接写 Task DB/`.proflow`，也不再使用 Side Panel。主路径使用 owning package 提供的 loopback Web surface；Task/Approval 最终仍通过既有 authenticated owner application 进入 Platform Host。endpoint/token 由产品 setup/materialization 生成，禁止手填、复制或暴露到页面。

Real-3 产品证据分两层：

1. **真人路径证据**：公开 CLI/`ProFlow Tasks`/真实 Worker Conversation 中用户实际可见的产品结果；
2. **Owner authority 证据**：Task/Node/Worker/Role/Execution 等对应 Owner public facts。

两层必须满足正式 Test Plan/Frozen Contract。如何观察 DOM/screenshot/AX、如何处理 controlled context、click timeout、runtime reconnect 或 auth，统一由 Acceptance Skill 条件加载当前 Browser/CLI/runtime references。

## Browser 工作集｜产品级约束

Real-3 的业务工作集固定为：

```text
ProFlow Tasks
+ Product Worker Conversation
+ Dev Worker Conversation
+ Test/Ops Worker Conversation
```

必须使用当前 Task 真正绑定的原始 Worker Conversation，禁止为了验收复制第二份同 identity Conversation。这个“哪些业务页面属于当前 Task”是 Real-3 产品事实；**如何把 Tab 纳入控制、谁拥有 Browser control、普通/privileged UI 用什么工具**不属于本 Flow，统一由 Acceptance Skill 决定。

## J1｜New Task / Worker / Requirement

`task.create` 创建 Task Owner 的 `PENDING` Task + 固定 Product/Dev/Test role bindings；binding 初始 `workerRef=null / conversationLocator=null`。Platform Host 随后并发执行三个 durable `worker.create`：Product Worker 完成后即可返回进入需求沟通，Dev/Test 在后台继续；若创建或绑定中途失败，backend Reconciliation 从 Task Owner durable facts 重新发现缺失 binding，并只补缺失 Worker/Conversation，不重建已经成功的 Worker。

`worker.create` 的产品合同：

```text
目标 Role identity 已知
→ 在该 Role 的真实 Conversation 中提交 WORKER_BIND <bootstrapFingerprint>
→ 产品必须能确认真实 user message
→ 从真实 /g/<roleRef>/c/<workerRef> 获得 Worker identity
→ 写回 Task Owner 的 workerRef + conversationLocator
```

API success、Tab 打开或旧 evidence 都不能替代上述产品事实。

Product Worker 在已绑定的 PENDING Task Conversation 中澄清需求；**Product GPT 不创建 Task、不动态发现 Role，也不从聊天 UI 猜 Task 状态**。正式 Requirement 写入唯一走 Product Custom GPT Action：

```text
POST /actions/putTaskDocument
operationId = putTaskDocument
documentType = REQUIREMENT
taskId + expectedTaskVersion + idempotencyKey
content 或受控 openaiFileIdRefs
```

Conversation 文件/Web Search/Code Interpreter 只用于认知；正式 Task facts/document 必须回 Owner Actions。Task 只有在 `REQUIREMENT` 文件及 hash 有效、固定三个 binding 全部有 `workerRef+conversationLocator`、Node role 合法等 prerequisite 全部满足后，才由 Task Owner `PENDING → READY`。

## J2｜用户确认 / Start

用户确认后在 `ProFlow Tasks` 页面点击 Start，公开入口为 `task.start`，内部进入 Task Owner `startTask`。必须使用当前 Task version；Task 非 READY 或 prerequisite 再检查失败都应 fail closed。

成功产品真值：

```text
before: Task READY
→ task.start
→ Task ACTIVE
→ first Node READY
→ currentNodeId = first Node
```

只看到按钮点击/HTTP 2xx 不能判 J2 PASS，必须有 Task/Node Owner facts。

## J3｜Observer / Restore / WAKE

backend Task Observer/Reconciliation 读取 `task.projection` 与其它 Owner current facts；projection 的 current Node 与 `roleRef/workerRef/conversationLocator` 是 canonical Owner facts。`BINDING_NOT_READY` 时禁止临时猜 Conversation。页面 event、Extension reconnect/startup 只提供低延迟 kick，不能成为唯一 progression source。

READY Node 产生 typed Carrier request：首次 run 用 `NODE_READY`，reopen run 用 `REOPEN`。Browser Extension 只负责产品定义的 restore/permission/submit/receipt/page reality：先恢复到持久 `conversationLocator`，要求 URL 中 roleRef/workerRef 与 Task binding 一致，再提交 `proflow.agent.browser-trigger.v1` trigger。WAKE 后必须有真实 `browser.hasMessage(fingerprint)` 对应的 user-message 产品事实；否则 side effect 仍未被产品证据确认，不能重发制造重复消息。`WAKE delivered != Node success`。

这里的 UNKNOWN/retry/reconciliation 自动化算法不由本 Flow 定义；当前如何处理统一服从 Acceptance Skill。

## J4｜Worker Turn / Action / Result

Worker 收到真实 WAKE 后应在**同一个 Worker Turn**自主读取 Task/Node/Requirement/context，并可连续调用多个正式 Actions；禁止 Browser 在每个 Action 后发送“continue”来人工驱动 Agent Loop。

Worker 只需要理解 `Task / Node / Document / Peer / Tools`。Task/Node/Document/Peer 事实走 Owner Public Contract；需要本机工程时按 Engineering Skill 执行。产品物理链仍是：

```text
Action → Gateway → ProFlow API
→ Browser Extension 独立 Local Tool lane
→ execution-local → macOS
```

Direct Tool 不进入 `executeCapability/getExecution/readExecutionOutput` lifecycle，Tool result 也不会自动推进 Node；Worker 必须显式调用 Task command。

## 产品恢复语义

backend Reconciliation 对非终态 Task 做 bounded catch-up，并从 durable Owner facts 重新发现 READY/REOPEN/RECOVERY_RESUME；Extension startup/event/reconnect 只加速，不拥有持久产品 truth。

若某个具体 package defect 被机械证明，回对应 `包能力` / `Package-Update-Loop` 处理；项目 Flow 只规定修复后应回到原产品 checkpoint 继续证明，不规定 ChatGPT 的通用 recovery/tool 操作。源码修复过程服从 Engineering Skill，真实场景恢复服从 Acceptance Skill。

若只能通过改变 Frozen Contract 才能继续：STOP，由总控进入 `SPEC_GAP/CONTRACT_CONFLICT`，不能让自动化偷偷绕过去。

## PASS

只有 J0～J4 全部有真实产品路径证据，真实消息/动作与 Owner Facts 一致，才允许 `REAL_3=PASS`。源码/测试映射、单测 PASS、WAKE API success 均不能单独替代真实 Journey。

## 2026-09-09 独立审计后的产品验证分界

执行前读取当前 `AGENT-DOC-02-05` §9–11 与 Extension Technical Design §23–24：Host enqueue credential 不可执行 Tool；Bridge 独立 lifecycle + Provider child 隔离；backend catch-up 必须测试分页/丢事件/重复事件/terminal race。

F9 已由 trusted local command 权限裁决关闭，当前进入分 Wave 源码实现；shipped Actions 与部署采用状态仍以真实证据为准。获准的 test/build/install 继承 OS 用户权限；Workspace 越界、确认提示和本机工程如何处理，统一服从当前 Engineering/Acceptance Skill，不在本 Flow 再维护第二套通用规则。

记录 `DESIGN_AUDIT / SOURCE_IMPLEMENTATION / PROVIDER_REALITY / REAL_3` 四种结果。test-governance 在 testcase 重绑前可报告 stale/unmapped，保持原报告并在正式实现后更新；禁止现在生成 08 evidence 来造 PASS。


## 2026-09-13 Real-3 terminal calibration

固定 Real-3 Task `task-real3-final-autowake-20260912` 已由 Owner facts 证明 `SUCCEEDED v11 / currentNodeId=null`：Dev 为 `SUCCEEDED run 1`；Test 经正式 `FAILED → REOPEN → START → COMPLETE` 后为 `SUCCEEDED run 2`，REOPEN 复用原 TaskRoleBinding / Worker / Conversation，没有 duplicate Worker。Test run 2 独立获得 Repomix / CodeGraph / Local Dev 成功证据并正式 `completeNode`。

因此 binding 三态、Deny suppression、Attention 双向桥/restart occurrence、Dev→Test durable WAKE、same-worker REOPEN、owner failure recovery、三 Direct Tool 独立 Test 等已解决 defect 不再属于当前 implementation blocker。它们仍必须保留自动化防回归与最终 Runtime/Carrier compatibility gate。

当前 22-Wave full-chain audit 继续验证源码、规范、测试、runtime/deployment 与最终 human evidence 的一致性；在最终 traceability Gate 完成前，不把该单个 terminal Task 自动等价为整个 Phase 3 Final GO。实时控制面只看 `02-当前接力/CURRENT.md`。

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

> 2026-09-09 Real-3 重构对齐：Browser Extension 不承担 Task progression scheduler。deterministic Task Observer / lost-trigger reconciliation 已迁到 backend application；Extension 保留 Task UI、Approval/Attention UI、System Observer 页面侧能力、Browser Carrier，以及与 Browser hot path 完全隔离的 Local Tool Effect Gate。
>
> 2026-08-23 Deployment Provisioning 增量：同一 Chrome Extension package 新增 **Deployment-only Custom GPT Provisioning** 分支，用于平台 setup 期间确定性操作 `/gpts/editor/*`。它与运行期 `/g/*` Task/Worker Carrier 在 command namespace、content script、state machine、DTO 与 verification 上隔离，只允许共享底层 Chrome API、authenticated loopback transport、heartbeat/session 与通用日志设施。
>
> 2026-09-09 继续保留 2026-09-04 的 Reality Hardening 结论：Deployment、Workflow Carrier、Collaboration、System Observer 共享 Browser Carrier 页面基础层，但 Workflow 的“业务 progression 决策/补偿扫描”已移出 Extension。新增第五条**独立 Local Tool line**，它不共享 Browser command queue/loop/dispatcher/state，只共享 Extension identity/auth/loopback primitive。新增真实页面 case 仍只进入 Browser Carrier detector/strategy/handler。

---

## 1. 定位

Browser Extension 完全归 Execution Domain 的 Browser capability，但内部可以组合 Application components。

它负责：

```text
Deployment Provisioning Web Adapter（setup 期间的 Custom GPT editor 自动化）
Task UI / New Task入口（application composition）
Approval/Alert UI（interaction channel）
Backend Task Observer/Reconciliation 的 Carrier kick/dispatch adapter（Extension 不拥有 progression detection）
System Observer（lowest-priority whole-system assessment coordination）
Background Carrier Controller（runtime real page operations）
P0 Side Panel
Browser Effect / Evidence
```

Deployment Provisioning 只拥有“如何在真实浏览器页面完成部署期 Web materialization”的执行机制；Agent Package material、Role、credential 与 Deployment Module 状态仍分别属于其 owning domain。

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
├── deployment-line/                  # 自动化部署：install/setup + Custom GPT provisioning + role identity 回写
├── workflow-line/                    # Workflow Carrier：Task UI、worker wake/resume；progression decision 在 backend
├── collaboration-line/               # Agent↔Agent 消息订阅、物理投递、反馈恢复
├── system-observer-line/             # 全系统只读观察、异常诊断、模型推理与 human escalation
├── local-tool-line/                 # 独立 Tool lane：poll/dispatch/bridge；不读 Browser/Observer business state
└── browser-carrier/                  # 四条线共享的真实浏览器基础层
    ├── controller                     # Background composition/controller；只编排 typed operation
    ├── page-reality                   # IDLE/BUSY/BLOCKED/UNKNOWN + typed blocker facts
    ├── composer                       # WRITE→COMMIT→READY→CLICK→REALITY
    ├── blocker-detectors              # 从真实 DOM 提取 permission/auth/unknown blocker facts
    ├── blocker-strategies             # deterministic first；新增 case 通过 strategy registry 扩展
    ├── semantic-actions               # allow-always/allow-once/deny 等 typed actuator，不暴露任意 selector
    ├── reality-verifier               # submitted fingerprint / prompt disappeared / current content session
    ├── reconcile-recovery             # APPLIED/NOT_APPLIED/UNKNOWN；no blind replay
    ├── vision-evidence                 # DOM 解释不足时的 screenshot/Vision 辅助证据
    └── shared-transport-session-log    # authenticated loopback、heartbeat/session、bounded logs
```

物理目录不要求完全一致；长期职责按“Browser/Deployment/Collaboration/System 页面线 + 独立 Local Tool line”理解。Local Tool line 不属于共享 Browser Carrier command lane。Workflow、Collaboration、System Observer 不得 import/复制 ChatGPT selector、按钮文本、React composer 细节或具体 permission case；新增真实页面 case 应局限在 Browser Carrier detector/strategy/handler 内。

### 2.1 Deployment Provisioning 独立流程

Deployment Provisioning 只在 Module setup / Agent Package setup 期间工作，使用高层 typed command（概念名 `PROVISION_CUSTOM_GPT` / `FINALIZE_CUSTOM_GPT_AUTH`），不得通过运行期 `ExecuteCapabilityRequest`、backend Task Observer 或 Browser Effect state machine 拼装。

```text
Extension install + authenticated hello/heartbeat
→ receive Agent Package provisioning material
→ OPEN/RESTORE /gpts/editor/*
→ FILL identity / Instructions / starters
→ UPLOAD staged Knowledge files
→ SELECT recommended model / capabilities
→ INSTALL Action Schema
→ VERIFY draft
→ private CREATE / promote
→ VERIFY live g-id / carrier URL
→ return result to Agent setup
→ Agent Domain registerRole + generate role credential
→ receive ephemeral Auth material
→ REOPEN editor / materialize API Key + Bearer
→ UPDATE + verify
→ discard ephemeral Auth material
```

硬边界：

- Provisioning DTO 不得出现 `taskId/nodeId/workerRef/conversationLocator/executionRef`；
- Provisioning 不创建或修改 Task/Worker/Execution Record/Collaboration fact；
- Auth ownership、Key 生成与 secret persistence 不属于 Extension；Extension 只机械输入本次动态 secret，且不得写入 `chrome.storage`、runtime config、日志或 Evidence；
- Knowledge ZIP 的解包、path traversal/symlink/大小/MIME/hash 校验发生在可信 Mac setup 侧；Extension 只获取经过 staging 的 bounded files/bytes；
- command JSON 不承载大型文件 base64；部署期文件 bytes 使用受认证、短时、opaque 的 loopback file transport；
- 页面 selector/DOM contract 不匹配时 fail closed，返回 typed UI-contract failure，禁止坐标猜测或模型自由点击；
- setup 必须可重入：已存在且绑定正确的 live GPT 优先 UPDATE/verify，只补缺失或 drift，不因重跑 setup 创建第二个 Role GPT。

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

Background 是 Extension 的 composition/controller，不是 ChatGPT DOM 规则库。它唯一编排 typed Browser operations：

```text
CREATE_CONVERSATION
OPEN_OR_RESTORE_CONVERSATION
WAKE_WORKER
DELIVER_COLLABORATION
CAPTURE_SCREENSHOT
OBSERVE_PAGE
RECOVER_DELIVERY
HANDLE_BLOCKER
```

UI/Workflow/Collaboration/System Observer 只请求 typed Browser operation；Local Tool 使用另一套 typed Tool command；不能直接散落调用 Chrome DOM primitives。Content Adapter 只上报页面事实并执行受限 semantic action；“这个 blocker 是否可信、是否可以自动处理”属于 Carrier strategy/policy，不属于 Content DOM 层。

Background 对新 ChatGPT case 的职责固定为：

```text
receive normalized reality
→ select registered blocker strategy
→ deterministic policy / bounded model diagnostic when allowed
→ request semantic action or human escalation
→ re-observe and verify reality
```

不得为 `getTask`、OAuth、某个按钮文本等具体 case 在主循环里堆叠专用 if/else；未知 case 必须 fail closed。

---

## 6. Content Script / DOM strategy

真实 DOM 操作通过受控 Content Script 或 `chrome.scripting.executeScript()`。Content Script 是薄 ChatGPT Runtime Adapter：提取事实、执行受限语义动作，不拥有 Workflow/Collaboration/System Observer/Local Tool 规则，也不拥有 trust policy。

页面观察输出至少区分：

```text
pageState = IDLE / BUSY / BLOCKED / UNKNOWN
activityKind = GENERATING / ACTION_PERMISSION / ACTION_RUNNING / ...
blockerFacts? = kind + bounded semantic facts + fingerprint + available semantic actions
```

`[role=dialog]`、某个 CSS selector 或按钮文案只能是 detector 的当前实现细节，不能被当作 Permission contract。多个 detector 可依次解释同一 DOM；无法安全解释时输出 UNKNOWN/BLOCKED，而不是猜测 IDLE。

Composer 提交冻结为状态驱动：

```text
locate composer
→ WRITE（使用对应元素 prototype 的 native setter + InputEvent）
→ COMMIT（readback 等于 expected text）
→ READY（submit action 当前可用，连续稳定观察）
→ CLICK
→ REALITY（真实 user message fingerprint 出现在 Conversation）
```

禁止用固定 `sleep(300)` 等时间猜测替代 COMMIT/READY。React/controlled input 的异步状态必须通过 readback/ready 状态闭环；页面导航替换 Content Script 后继续依赖新的 `contentInstanceId + URL` 重新验证。

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
→ structured observation/diagnostic
```

Vision/FAST/REASON 可以帮助 UNKNOWN case 归因或选择下一步观察，但不能覆盖 identity、trusted target、declared operation、stale fingerprint、Execution Approval 等硬规则，也不能直接成为 Task/Execution business success。

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
→ backend Task Observer/Reconciliation request WAKE
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

Browser/Carrier durable Effect / Approval / cross-worker peer wait 是 Turn boundary，结果 ready 后 backend Task Observer/Reconciliation 再请求 WAKE 同一 Worker。

---

## 12. Backend Task Observer / Reconciliation 与 Extension 边界

Task progression detector/reconciliation 不再运行在 MV3 service worker。backend application 读取 Task drive projection 与其他 Owner current facts，做 deterministic next-step + bounded catch-up。

Extension 只提供：

```text
page/Carrier reality
RESTORE/WAKE physical dispatch
low-latency kick / reconnect observation
receipt / UNKNOWN reality
```

页面 event、Extension restart/reconnect 只加速；即使它们全部丢失，backend bounded catch-up 也必须最终重新发现 READY/RESUME。Extension 不持有 progression single-flight/backoff，不把 Tool result 自动映射成 completeNode。

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

## 14. GPT Action Permission / Carrier Blocker Strategy

ChatGPT Action Permission 是 Browser Carrier 的机械 gate，不是 Workflow/Execution 的业务审批。真实页面可能在任意 Worker Turn 再次出现 Permission，因此 happy path 不能依赖“用户曾经手工点过一次 Always Allow”。

Permission detector 只提取事实，例如：

```text
permission kind
target/origin or connector identity
operationId/tool identity
bounded shared payload summary
available actions（allowAlways / allowOnce / deny）
permissionFingerprint
```

Carrier strategy 再基于正式平台事实分类：

```text
current Role/Worker context matches
+ target belongs to current trusted ProFlow Gateway/Connector
+ operation belongs to current Role authorized Action contract
+ permission fingerprint/session/url remain current
→ AUTO_ALLOW
→ semantic allowAlways
→ re-observe prompt disappeared / action continued
```

任一关键事实缺失、未知 host/operation、Role/context mismatch、DOM 无法解释或 fingerprint 已变化：

```text
HUMAN_REQUIRED / UNKNOWN
→ do not click
→ preserve page + bounded evidence
→ surface Carrier Attention / diagnostic
```

人对异常 Carrier Permission 的一次性放行默认使用 `allowOnce`；除非明确重新建立长期 trust，不把人工异常处理升级成新的永久白名单。

`x-openai-isConsequential:false` 可以作为 Role Action contract 的辅助 metadata，但不能单独决定 auto-grant。Extension 也不得维护与 Host/OpenAPI 脱离的第二份 operation allowlist；优先通过只读 authoritative projection/classification 取得 Role + operation + current target 的判断。

Blocker 机制必须可扩展：新增 OAuth/Auth、Tool Confirmation、文件访问或未来 ChatGPT UI case 时，只增加 detector/strategy/handler；Workflow Carrier、Collaboration、System Observer 主流程原则上零修改；Local Tool lane 也不得因为页面 blocker case 而修改。

OpenAI/ChatGPT confirmation ≠ Execution Effect Approval。真正 Effect 风险仍由 Execution Policy/Approval Owner 决定，Carrier 自动放行不得绕过该 Owner。

---

## 15. Human Decision / Approval UI

Extension UI 可承接：

```text
Task start confirmation
Execution Approval
Carrier Attention（异常 Browser blocker 的人工接管）
System alerts
Deployment ACTION_REQUIRED guidance
```

必须区分两种语义：

```text
Execution Approval
= durable business/effect approval
= Execution Owner fact

Carrier Attention
= 当前 Browser reality 无法自动安全处理
= transient/derived interaction projection
= 重新观察页面后可重建或自然消失
```

Carrier Attention 不复用 `execution_approvals` Store。它可以携带 `attentionRef/kind/taskId/roleRef/workerRef/reason/evidenceRef/actions[]` 等 bounded interaction descriptor；不同 blocker 可以提供不同 semantic actions。用户点击后仍需重新校验同一 tab/contentInstanceId/URL/blocker fingerprint，不一致返回 stale/fail-closed，不能按旧 UI 状态操作新页面。

正式业务结果仍提交给对应 Owner；UI不是 Approval/Task/Deployment真源。Future Feishu 可替换/并存 interaction channel。

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

运行期普通 Task/Artifact 文件不由 Browser DOM 搬运：

```text
Conversation → openaiFileIdRefs → Gateway → Execution materialize
Task/Execution Artifact → Gateway openaiFileResponse → Conversation
```

唯一独立例外是 **Deployment Provisioning 的静态 Role Knowledge 上传**：它不是 Task File Bridge，也不是运行时 Artifact transport。可信 Mac setup 侧从 Agent Package ZIP 解包并安全校验后，通过短时 authenticated loopback file transport 向 Extension 提供 bounded bytes；Provisioning content script 只负责把这些静态部署文件写入 GPT editor 的 Knowledge file input。

Context Pack / Patch 都是 Execution Artifact subtype；Deployment Knowledge 不因此变成 Execution Artifact 或新 File Domain。

截图因 OpenAI image return asymmetry继续走 Browser/Execution → Model Vision。

---

## 19. Page runtime / recovery

Page runtime 可表达：

```text
IDLE / BUSY / BLOCKED / UNKNOWN
+ normalized activity/blocker facts
```

但不是业务状态机。`BLOCKED` 是页面事实，具体 Permission/Auth/Tool Confirmation 等 case 由 Browser Carrier strategy 解释；Workflow Carrier/Collaboration/System Observer 不理解具体 DOM case；Local Tool lane完全不读取页面 DOM case。

Observer 只消费 normalized Carrier transition：BLOCKED/UNKNOWN 页面不得触发“页面可继续”的 Task recovery；只有真实重新观察到可驱动 IDLE（或其他明确 typed resume signal）后才允许触发恢复。

Recovery 定义为 re-observe + re-decide，不等于 retry：

```text
extension reload/reconnect
→ discover current tabs
→ rebuild transient sessions
→ query durable unfinished Browser Executions
→ re-observe current page/blocker reality
→ reconcile APPLIED / NOT_APPLIED / UNKNOWN
→ safely resume or escalate
```

任何语义动作执行前都重新验证 transient identity 与目标事实：

```text
same tab
+ same contentInstanceId
+ same URL
+ same blocker/message fingerprint
```

不一致即 stale/fail-closed。`UNKNOWN` 继续遵守 no blind replay；模型可以帮助诊断但不能把 uncertain Effect 变成 retry permission。

Task terminal 时 backend Task Observer/Reconciliation stop-driving；历史页面可人工打开，但不主动业务 WAKE。

### 19.1 Permission 与 Attention 生命周期补充

真实 Worker Conversation 可能先收到第一条 Action Permission，随后 `worker.bindWorker` 才把同一 Role 的 `workerRef + conversationLocator` 写入 TaskRoleBinding。此时 policy 仍须先满足 current Role、trusted Gateway、authorized operation、`/g/{role}/c/{worker}` URL 全部硬约束；只有精确 Role binding 已存在、且两个 Worker 绑定字段同时为空时，才返回 transient `DEFER`。`DEFER` 不点击、不产生 Attention，在同一 tab/content/URL/fingerprint 上 bounded reclassify：精确绑定后进入正常 `AUTO_ALLOW`，超时、binding 缺失、部分绑定或任何冲突均转 `HUMAN_REQUIRED`。

Carrier Attention 是 occurrence-scoped transient projection。`attentionRef` 必须包含独立 occurrence identity，不能只由 `tabId + permissionFingerprint` 推导；同一 occurrence 的重复观察复用 ref，释放后再次出现同 fingerprint 必须得到新 ref。content replacement、URL/fingerprint 改变或 Attention 释放会让旧 ref stale，旧操作必须拒绝。

人工 `allowOnce` 解除 blocker 后仍允许正常 `BLOCKED → IDLE` Observer recovery。人工 `deny` 则在点击前持久化一个只绑定当前 Attention/tab/Task/Role/Worker/URL 的 continuation denial；它只消费并抑制下一次 matching IDLE recovery，不改变 Task、Execution 或 Approval，不影响其他 tab/Worker，也不形成永久停用。

在该 denial 被真实 `IDLE` continuation 消费前，**Human Deny 是当前 occurrence/context 的最高优先级 transient Carrier guard**。Permission handler 必须在 classify、DEFER reclassify 与 automatic semantic action 前按 `tab/contentInstanceId/URL/fingerprint/task/role/worker` 复验；命中时只保持/重建 `HUMAN_DENIED` Attention，禁止 `AUTO_ALLOW`。backend Task Observer 保持不了解 Permission；Background Carrier Controller 必须在每次实际 `task.wake` dispatch 前按 `taskId/roleRef/workerRef/conversationLocator` 做最后 guard，使 startup、scheduled retry、Task application event 与 durable resume signal 都不能绕过人类拒绝。

主 `/tasks` loopback 页面通过 authenticated Browser Reality Bridge 接收 bounded Attention mirror，并把 `allowOnce/deny` relay 为 Extension command；cookie session、exact same-origin、current Attention ref 与 action allowlist 任一不满足即拒绝。Extension-owned Tasks 页面继续作为直接 runtime fallback。

MV3 Background 初始化、`onStartup` 与 `onInstalled` 必须主动查询现有 `https://chatgpt.com/g/*` tab，并向 live Content Script 请求只读 snapshot，以重建 session/Attention；不得等待 DOM Mutation 才恢复。持久化的 uncertain auto-attempt 继续禁止 restart 后重复点击。

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

## 22. Local Tool 独立 Lane 与 Bridge Runtime（2026-09-09）

GPT-facing Repomix / Local Dev / CodeGraph 不进入现有 Browser `/v1/commands/* + runBridgeLoop()`。Extension 新增独立：

```text
/v1/local-tools/commands/*
→ runLocalToolBridgeLoop()
→ Local Tool dispatcher
→ authenticated local-tool bridge client
→ execution-local
```

两条 lane 不共享 queue、pending map、serial loop、timeout/backoff、dispatcher、readiness、locks、tab/session/Observer state。`Local Dev.run/process` 即使长时间运行或挂死，也不得阻塞 Browser heartbeat/poll/WAKE/submit。

Local Tool lane 不 import Task Observer、System Observer、Collaboration Carrier、ChatGPT DOM adapter；Browser lane 不 import Local Dev/Repomix/CodeGraph implementation。最多共享 Extension identity、credential derivation、base loopback config 与通用日志 helper。

Extension 只做 Local Tool Effect Gate 与转发，真实 fs/git/process/Repomix/CodeGraph 运行在本机 `execution-local`。

Bridge runtime 的**正式生命周期归 `execution-browser-extension` 模块**，不得继续隐式绑定 `execution-runtime` 进程生命周期。该模块负责启动/停止 loopback bridge、发布 endpoint/credential/readiness，并在同一进程内维护彼此独立的 Browser lane 与 Local Tool lane transport state；共享仅限底层 HTTP server/auth/Extension identity primitive，不共享 queue/pending/timeout/backoff/dispatcher。

部署依赖方向必须与运行时一致：`execution-browser-extension` 不再 `requires: execution`；它继续提供 `execution-browser-executor`，并新增内部部署 contract `local-tool-bridge`。`execution-runtime` 正式 `requires: execution-browser-executor`；platform-host 正式 `requires: local-tool-bridge`。不得继续靠 shared-facts 隐式形成与 descriptor 相反的依赖。

`execution-runtime` 以后只是 Browser lane 的受信任客户端，用于需要 durable Execution semantics 的 Browser/Carrier operation；它停止或不可用时不得关闭 bridge runtime。platform-host/API 只是 Local Tool lane 的受信任客户端，用于投递已通过 Role×Tool×Operation admission 的 Tool command；它不得直接 import/call `execution-local`。这样 `Execution Runtime DOWN ≠ Local Tools DOWN` 才在进程生命周期层真实成立。

## 23. 可实施的 Bridge lifecycle 与冷启动边界

模块 owns lifecycle 不等于必须另建 Domain/通用 Runtime。复用 Platform CLI 已有 lifecycle/start-owner，以模块独立 start/stop handle 创建 Node bridge；MV3 background 只运行两个 transport loop，不能运行 Node Provider。

`execution-browser-extension` 的 start 先发布自身 endpoint、分权限 credential 与 generation 并绑定 loopback listener；此阶段不得等待 Host/Execution/Model READY。现有 `materializeRuntimeConfig()` 强制读取 Host application facts 的逻辑必须拆成可后绑定 Task/Approval application client；缺失只影响对应 UI/Browser operation，不能阻塞 local bridge 冷启动。Host 随后启动，再由内部 operation client 按需获取 Owner endpoint，不能把请求期依赖升级成 module startup requires。

Bridge module 新增 `requires: execution-local`，保持其现有 library dependencies；不新增反向 Host/Execution/Model startup edge。provider library 已安装不等于所有 Provider READY。`execution-runtime` 添加 `execution-browser-executor` requires；Host 添加 `local-tool-bridge` requires，移除全局 execution/model-inference 硬前置；Gateway 移除 execution 硬前置。内部 Execution identity 调用 Host、Model policy 调用 Model 均为 operation dependency，不在启动时做全体 READY conjunction。只把 requires 标 optional 不能解决已安装 Provider 的排序边（现有 graph.ts 仍生成边）。

Browser executor 语义适配器可作为本包 public client factory 由 Execution 调用；只有 bridge module 可以创建/关闭 listener。避免把现有 `createBrowserExecutorComposition()` 连同 Host lookup、Vision 与业务 callbacks 整包搬成 bridge 启动条件。

停 Execution 只 drain 该客户端并把不确定 durable effect 留给原 Owner；不得关闭 bridge。停 bridge：先停止新 admission、撤销 generation、对已 dispatch 未确认请求返回 UNKNOWN，bounded drain，再关闭 lane transport 和本模块拥有的 Provider child。只停止已确认属于本模块的进程，禁止杀任意 PID。并发 start/stop 使用模块现有 lifecycle guard；失败清理只能清理本次创建的资源，禁止旧 close callback 关闭新 generation。

## 24. 并行 loop 不等于事件循环隔离

独立 queue/timeout 是必要条件。Node bridge control plane 不在自己的事件循环执行 Repomix/CodeGraph 同步索引/扫描、重计算或阻塞 native 调用；优先在受本模块管理的固定 Provider child 中加载官方 library，CLI 可沿同一受控 child 路径调用。使用既有 Node child_process 能力，不建设通用 Provider framework。每个 Provider 有独立并发限额/输出上限/取消/错误域；一个 Provider 挂死不会持有全 lane 执行锁。

MV3 Local Tool loop 仅做 bounded JSON、认证转发和快速 handle 接收；不得 await 长进程退出才 heartbeat。两个 lane 分别记录 consumer freshness 与 backoff，Browser hello/session freshness 不作为 Local Tool READY。扩展整体卸载/浏览器进程退出会同时失去两 lane，这是共同物理故障域；不把 lane 隔离宣称为可抗整个 Chrome/bridge 崩溃。

凭据分权、command generation、expiry、claim/execute/result 匹配按 `AGENT-DOC-02-05` §9–10；Host 能 enqueue 不意味着能执行。

## 审计补充：消除 Agent 的间接启动环

目标 descriptor 还必须删除 `agent-runtime.requires: execution`；保留 `task-orchestration`。真实 Agent adapter 只创建 Role store，start/stop 为 library no-op；逻辑 Collaboration 接收 delivery evidence，不要求 Execution 服务参与初始化。ExecutionRef 作为消息投递证据字段不构成启动依赖。

否则新增 Execution → Extension 后会形成 `execution-runtime → execution-browser-extension → agent-runtime → execution-runtime` 环，也会让 Host/Task/Peer 间接依赖 Execution。Delivery 的请求期 durable Execution 依赖仍保留在 Carrier/composition，不删除消息 Evidence 语义。全量演算必须包含 Agent descriptor，不能只验证三个修改模块的子图。

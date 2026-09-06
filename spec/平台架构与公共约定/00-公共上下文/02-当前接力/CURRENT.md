# CURRENT｜Phase 3 当前接力

> 更新时间：2026-09-06。这里是下一 Chat 的唯一滚动执行入口；旧 handoff 只在 `90-历史记录`。

## CURRENT_STAGE

```text
ARCHITECTURE = FROZEN
REAL_1 = PASS
REAL_2 = PASS / FROZEN
DEPLOYMENT_SUCCESS = YES / FROZEN
CURRENT_EXECUTION_GATE = REAL_3_J0_J4
REAL3_BROWSER_CARRIER_AUTOMATED_TEST_GATE = PASS
REAL_3 = NOT_PASS
PHASE3_FINAL_GO = NO
```

## FINAL_GOAL

完成固定 Real-3 Task 的 J1→J4 真实“人工视角自动化”验收。Deployment 不重开；真实缺陷只做 owning package 最小修复。Browser/UI symptom Reality-first，截图就是眼睛；修复后回 SAME SCENE，不重建固定资源。

## CURRENT_AUTHORITY

```text
branch = main
HEAD = d40d371 / composer-selection product fix committed; 0.1.44 release not yet executed
working tree = execution-efficiency docs + privileged Browser Harness only; product fix is committed separately
J1 = PASS
J2_SAME_SCENE = PASS / fixed Task visible
J2_HUMAN_START = PASS / official Confirm / Start clicked exactly once
TASK_OWNER = ACTIVE / v7 / currentNodeId=dev / dev READY run1 / test PENDING run1
TASK_BINDINGS = EXACT / Product + Dev + Test all bound to fixed Worker Conversations
GENERATION_IDENTITY_RELEASE = PASS / platform-host 0.1.18 + execution-runtime 0.1.18
OBSERVE_WIRE_ROOT_CAUSE = CLOSED / execution-browser-extension 0.1.43 released/adopted
CHROME_0143_ADOPTION = PASS / ID eehdadpmjffomabiedcjijiakconalab / visible 0.1.43
PLATFORM_SETUP = PASS / 3/3
PLATFORM_START = PASS / 4 success / 19 skipped / 0 failed
PLATFORM_READY = YES
BROWSER_CARRIER = ONLINE / sessionOnline=true / commandConsumerReady=true
MODEL_PROVIDER = ONLINE / http://192.168.0.108:8080/v1 / models HTTP 200
MODEL_RUNTIME = READY / fast READY / reason READY
EXECUTION_MODEL_DECISION = READY
J3_IDENTITY_GATE = PASS
J3_OBSERVE_GATE = PASS
J3_WAKE_EXECUTION = execution:fbc00b27-bf5b-4325-a3ef-4269579fdabd / FAILED / NOT_APPLIED
J3_WAKE_LATEST_ERROR = COMPOSER_SUBMIT_NOT_READY
J3_COMPOSER_ROOT_CAUSE = VERIFIED / selector list matched earlier auxiliary textarea before real #prompt-textarea
J3_COMPOSER_FIX = LOCAL_PASS + COMMITTED / d40d371 / full Extension 161/161 + typecheck + root build + git diff --check PASS
J3_COMPOSER_RELEASE_PLAN = execution-browser-extension 0.1.43 -> 0.1.44 patch / Registry target MISSING / publish pending
J3_DEV_NODE_READY = NOT_DELIVERED
J4 = NOT_STARTED
A4_BROWSER_TARGET_OWNERSHIP = DEFERRED / unrelated
```

J1/J2 已完成。Generation identity、Browser OBSERVE wire、0.1.43 adoption、Browser pairing、Platform READY、Model Runtime/Decision 都已经真实 runtime 关闭。当前 J3 只剩 Browser composer 提交缺陷：真实 Dev 页面同时存在前置辅助 `textarea` 与真正 `#prompt-textarea`，旧 selector-list 按 DOM 顺序误选辅助 textarea，导致 `COMPOSER_SUBMIT_NOT_READY`。最小修复已经提交并通过 161/161 + typecheck + root build + diff-check；当前唯一下一动作是完成 0.1.44 release/adoption，然后 SAME-SCENE 重放同一 `FAILED/NOT_APPLIED` wake。只有 Dev Conversation 真实出现新 `NODE_READY` 才算 J3 PASS。

## CURRENT_CHECKPOINT

```text
REAL_3_J1_PASS_J2_PASS_J3_COMPOSER_FIX_LOCAL_PASS_0144_RELEASE_PENDING
```

## CURRENT_PROBLEM

```text
problem class = REAL3_J3_CHATGPT_COMPOSER_SELECTION
previous identity blocker = CLOSED
previous OBSERVE wire blocker = CLOSED_IN_0.1.43
previous Browser setup/pairing blocker = CLOSED / setup 3/3 + Platform READY
previous Model decision blocker = CLOSED / Provider online + Model Runtime READY + Execution modelDecision READY
primary owner = execution-browser-extension ChatGPT runtime adapter
fixed Task reality = ACTIVE/v7/currentNodeId=dev; Dev READY/run1; Test PENDING/run1; all RoleBindings exact
latest durable wake = execution:fbc00b27-bf5b-4325-a3ef-4269579fdabd / FAILED / NOT_APPLIED
latest failure = COMPOSER_SUBMIT_NOT_READY after EXECUTION_STARTED -> EFFECT_STARTED
FIRST_DIVERGENCE = production composerElement() used selector-list querySelector; current ChatGPT DOM places an auxiliary textarea before canonical #prompt-textarea, so DOM order selected the wrong element
real-browser proof = direct write to #prompt-textarea + InputEvent changes action button from voice state to `发送提示词` within ~250ms
candidate = explicit `#prompt-textarea` first, then textarea, then contenteditable fallback
candidate gate = Extension full 161/161 PASS + typecheck PASS + root build PASS + git diff --check PASS
candidate commit = d40d371
release target = execution-browser-extension 0.1.44 patch
current stop point = clean-tree release gate -> publish 0.1.44 -> Registry exact -> Workspace update -> Chrome adoption -> SAME-SCENE recovery once -> Dev NODE_READY
execution invariant = no revisit of identity/model/pairing unless new regression evidence appears
```

### 已确认事实

1. 0.1.39 pairing 原 blocker 已真实关闭：`hello 200 → carrier/attentions 200 → commands/next 204 → heartbeat 200`，`platform setup` 曾完成 3/3。
2. fresh `Cannot use import statement outside a module` 没有复现；旧 Extension error 不再是当前 root cause。
3. 三个 `worker.create` Owner request 的 roleRef / roleUrl 正确；不是 Task/Role Owner 生成错请求。
4. 真实 Browser 旧失败现场发生角色错位：Product 的 `WORKER_BIND` 进入 Dev Conversation，Dev 的进入 Test Conversation，Test 的留在 Product root composer draft。
5. baseline 已机械证明结构缺口：Background `OPEN` 可按 tabId 接受 session observation 而缺少本次 OPEN freshness/target identity proof；`worker.create` 历史顺序允许在最终 role identity 校验前进入 durable effect / submit；slugged Custom GPT Conversation URL 需要 canonical role identity 后才能和 Owner truth reconciliation。当前 local candidate 已在原结构内收口这三个边界。
6. Git 历史已确认这些核心缺口不是 2026-09-04 `2e6bbd8 refactor(browser): harden Real-3 carrier reality` 新引入：`worker.create` / parser 可追到 2026-08-13 `f3099347`，`OPEN → waitForObservation(tabId)` 可追到 2026-08-13 `8f25100a`。最近重构使真实长生命周期/recovery 条件把旧缺陷暴露出来。
7. checkpoint commit `e02c130` 已包含 slugged role identity helper 与 worker.create wrong-role pre-effect guard。Codex 随后新增 Background 接线 RED 并得到 `19 pass / 1 fail`，timestamp candidate 接线后曾到 `20/20 PASS`、package `151/151`、typecheck/build PASS；但邻接审计证明该候选不能 release：`observedAt` 是 content-side 毫秒 wall clock，`notBeforeMs` 是 Background wall clock，同毫秒旧 observation 会被 `>=` 接受，因此它不是严格 causal freshness proof。
8. 并发/command correlation 已机械确认 `ALREADY_SAFE`：`worker.create` 由全局 `writeTail` 串行化，Background bridge 按 commandId 串行 execute/result，未发现共享 currentRole/currentWorker 造成串位；禁止把 queue/serializer 纳入当前修复。
9. Background 重复的非 canonical `carrierIdentity()` 已移除；OPEN、Node Executor、Recovery、Carrier Attention / Permission lifecycle 现在共用 `parseChatGptCarrierIdentity()` 的 exact role/worker 语义。
10. Execution Frozen 语义明确允许 `UNKNOWN → SUCCEEDED / FAILED / UNKNOWN`：确认 applied → success，确认 requested effect not applied → failed/not-applied 后可重新决策，仍无法判定 → `UNKNOWN/STOP/Human`。当前 runtime 只有 automatic `reconcile()`，`worker.create` verifier 没有 `NOT_APPLIED` 分支，也没有公开 operator resolution/abandon/compensation API；这是当前实现相对 Frozen UNKNOWN recovery 语义的 continuation gap，不能靠 DB 改写或 blind replay 绕过。
11. timestamp/source-regex candidate 已替换为行为级 causal gate：Background 在 `tabs.create` 前捕获单调 receipt generation，`processContentObservation()` 每次真实收件后递增 generation；OPEN 只接受 boundary 后、同 tab、exact canonical target 的 receipt。测试已覆盖 pre-existing stale、same-millisecond stale/new、root/slug/conversation/worker identity，wall clock 不再参与 freshness 决策。
12. 三条固定 UNKNOWN 的当前 Browser + Owner evidence 均不足以穷尽历史 attempt，Product / Dev / Test intended effect 正式状态仍都是 `UNKNOWN`；foreign-target message/draft 是 incident evidence，但不是 intended `APPLIED`，也不能单独证明 intended `NOT_APPLIED`。
13. 最小完整 continuation 方案为 C：增强 `worker.create` verifier 仅在 exhaustive negative evidence 下返回 `NOT_APPLIED`，并增加 Execution-owned、认证且可审计的 Human/operator resolution surface 处理无法机械收敛的 legacy UNKNOWN。该方案保留为未来 robustness gap；用户已裁决当前 Real-3 不为 legacy UNKNOWN 阻塞，旧 Execution 原样保留为事故证据。
14. Gateway 邻接审计已真实复现：同 Product credential + 同 Task 走 Public Gateway 的 `getTask` 返回 `403 {"error":"GATEWAY_FAILURE"}`；直达 Platform Host 同请求返回 `403 {"error":"TASK_ROLE_BINDING_REQUIRED"}`。当前直接 blocker 是 TaskRoleBinding 未完成，不是 Dev Tunnel 断线或 Model dependency。
15. Gateway `/health=200`、public ingress 可达；Gateway `/ready=503` 因 Platform Host aggregate `/ready=503`，而 Host 当前仅 Model dependency NOT_READY，Task/Agent/Execution 都 READY。Model NOT_READY 不阻止 `getTask` route，仅污染 aggregate readiness。
16. Product 新 Worker Conversation 已由人工 Role-root `WORKER_BIND` 创建。2026-09-05 Playwright 当前页回读 verified：role=`g-6a97182669f88191a943e806a3e1b42a`，worker=`6a9b243c-7af8-83e9-a005-2ccfb8c5c8cb`，exact locator=`https://chatgpt.com/g/g-6a97182669f88191a943e806a3e1b42a-yun-ying-chan-pin-jing-li/c/6a9b243c-7af8-83e9-a005-2ccfb8c5c8cb`。
17. Product 首次 bind 已通过正式 Owner path 完成：pre-bind=`null/null`，`browser.bindWorker` HTTP 200 `{bound:true}`，随后 `browser.binding` readback exact workerRef + locator，`EXACT_MATCH=YES`。Product 当前 Worker 已完成 getTask + Requirement confirm；后续禁止再次发送 Product `WORKER_BIND` 或再次 bind。
18. Gateway 存在独立诊断缺陷：downstream 非 2xx 保留 HTTP status 但丢失 typed body，最终把 `TASK_ROLE_BINDING_REQUIRED` 等 Owner 错误压成 `GATEWAY_FAILURE`。该缺陷不阻塞当前 J1，可后续最小修复。
19. 2026-09-05 Product Requirement confirm 已真实完成：Playwright 提交“确认”时 Enter 阶段虽 timeout，但 ACT 后 screenshot + DOM 均看到用户消息已提交；随后 Product 页面明确回显“Requirement 已正式写入 Task，Task version 已更新为 3”，因此没有盲重发。
20. 同一事件已由 Task Owner 独立回读：Extension 正式 action 打开的原始 `ProFlow Tasks` Tab 建立 HttpOnly task web session 后，通过同源只读 `/tasks/api/task` 调 `task.get`，返回 Task=`PENDING`、version=`3`、currentNodeId=`null`、Product binding exact、Dev/Test binding=`null/null`、两个 Node=`PENDING`、readiness=`false`；`task.list` 进一步返回 `canStart=false / blockedReason=TASK_ROLE_BINDING_INCOMPLETE`。J1 当前 blocker 因而机械确定为 Dev/Test 尚未正式上岗，不是 Product Requirement、Gateway、Model 或 DevTunnel。
21. 本次重新打开原始 Tasks surface 暴露一个新的冷启动诊断缺陷：`/tasks/app.js` 的发布脚本仍 import `../src/carrier-attention-view.js`，loopback 页面解析为 `/src/carrier-attention-view.js`，该路径不携带只限定 `Path=/tasks` 的 task session cookie，最终命中 Bridge Bearer auth 并 401，UI 停在 `Connecting...`。该问题已 screenshot + Console + current source 三层定位；当前 Owner readback 可经同源 `/tasks/api/task` 完成，因此先记录、不 bump/publish/update；J2 若需真实 Start UI 时必须先重新判定其 blocker 等级。
22. Dev 人工换人已完整闭环：固定 Dev Role root 只发送一次 `WORKER_BIND`，真实 worker/c-id=`6a9b4632-ca8c-83e9-a4bc-9de9e229e515`；Playwright screenshot + URL + DOM exact 验证 role/locator；`browser.binding` pre-read=`null` 后唯一一次 `browser.bindWorker` 返回 HTTP 200 `{bound:true}`，post-read exact match。随后同一 Dev Conversation 普通请求成功 `getTask`，读到 Task v4/PENDING 与 dev Node PENDING，Owner 再回读仍 v4，证明 getTask 为纯读且未开始 Execution。
23. Test 人工换人也已完整闭环：固定 Test Role root 只发送一次 `WORKER_BIND`，真实 worker/c-id=`6a9b8ae0-f694-83e8-b4a2-0d20cbc5c04a`，canonical role/locator verified；Owner pre-bind=`null`，唯一一次 `browser.bindWorker` 返回 200 `{bound:true}`，post-read `EXACT_MATCH=YES`。Test bind 后 Owner 自动推进 Task 到 `READY/v6/readiness=true/canStart=true/blockedReason=null`，三份 Role binding 全 exact。Test 初始 GPT reply 出现约 30 秒 UI BUSY，截图确认无 Permission/新增文本后仅停止该 Chat generation；同一 c-id reload 后普通 getTask 请求成功读到 Task READY/v6 与 test Node PENDING，最终 Owner 再回读仍 READY/v6，证明 J1 已完整闭环且尚未启动任何 Node。
24. J2 Human Start 前置复验已把 Tasks cold-load 401 升级为真实 blocker：原始 Tasks Tab SAME-SCENE reload 后仍 `Connecting...`，Console exact `GET /src/carrier-attention-view.js -> 401`。最小修复只改 Tasks 单文件入口边界与 targeted regression：CP-EXE-BR-33 先 RED（3/4）后 GREEN（4/4）；package `156/156`、package/root typecheck、root build、scoped Biome、`git diff --check` 均 PASS，built `dist/extension/tasks.js` 无 runtime import。当前真实 Product Workspace / Chrome 仍是 0.1.39，因此必须经过正式 release/update 才能回 SAME SCENE 证明 401 真正关闭。
25. `pnpm package:release --plan` 已只读确认 execution-browser-extension 需要独立 patch release；随后已完成 `0.1.39 → 0.1.40` 发布。publish 子步骤明确成功，但 release 脚本紧接着的 Registry exact 因传播延迟短暂失败；独立 authoritative readback 随后返回 `0.1.40`，因此裁决为 Registry propagation race，禁止重复 publish。Product Workspace 已通过公开 `platform stop → platform update --package @tomflow/proflow-execution-browser-extension` 更新到 0.1.40，loadDir manifest 也是 0.1.40。
26. 2026-09-05 Chrome privileged UI 执行方式事故已沉淀：为完成同一 ProFlow Extension Reload，先后尝试 Playwright `chrome://` navigation、`chrome-extension://` navigation、AppleScript JS、AX 菜单等多条路径，造成反复切窗/抢用户前台；这些尝试没有增加业务 authority。最终一次正确的 `chrome://extensions` 截图已经足够确认同一 Extension ID、当前可见版本 `0.1.39` 和 Reload 控件。该事件定义为**执行方式错误，不是产品 defect**。以后 privileged UI 固定“一次切前台 → 一张截图定位 → 一次 mutation → 一张截图验证 → 后台 authority readback”，截图足够后禁止继续探索更“程序化”的替代路线。
27. **历史中间态，已被事实 37 废弃。** 用户新增其它 Chrome Extension 后，ProFlow 卡片位置漂移，暴露最早“名称后全局取第一个 Reload/Remove”的结构风险；当时曾改成 `Extension ID + 名称 → 最小目标卡片容器 → descendants` 并在一次 0.1.40 Reload 中通过，但 Chrome 152 后续真实现场证明“最小 AX card container”本身也不可靠。此条只保留演进历史，禁止作为当前 mutation 规则；当前唯一有效裁决见事实 37 与 `Browser-UI自动化.md`。
28. Browser update 后平台恢复暴露新的真实 blocker：Remote Connection 已从 1/3 恢复到 2/3，但 `platform start` exact 阻塞于 `MODEL_MAPPING_STALE`。连续 `platform setup` 都输出“全部模块均已就绪”却最终仍 2/3，源码/已安装 dist 对齐审计证明不是 CLI 版本漂移。
29. `MODEL_MAPPING_STALE` 根因已机械定位：`model-runtime.status()` 用 live Provider `/models` 检测 drift；旧 `model-runtime.setup()` 却先用 model-provider shared facts 计算 fingerprint，若旧 mapping 与旧 shared facts 相等就 early-return，因此真实 live drift 无法被 setup 自动修复。现有测试曾在 stale 后手工 `providerFacts(workspaceRoot, observed)`，替产品提前刷新 shared facts，掩盖了真实用户路径。回归已改为不手工刷新 provider facts，先 RED `mappingCalls 1 !== 2`；实现改为 setup 先读取 live inventory，用 live fingerprint 决定复用/重映射，并将 live models 传给原 mapInventory，targeted GREEN。全 package 67/67、package typecheck、root typecheck、root build、git diff --check 均 PASS。
30. `model-runtime 0.1.24` 已真实解决“新增无关 Embedding 导致稳定 FAST/THINK 全量重探测”问题：旧 FAST/THINK modelRef 仍存在时只同步 inventory fingerprint，不重新全量 probe；Registry/Workspace 已对齐，真实 `platform setup` 已重新 3/3。
31. `execution-browser-extension 0.1.41` 已正式发布、Workspace/loadDir 对齐，并由用户手动完成 Chrome adoption；fresh screenshot 显示 `ProFlow Execution Browser 0.1.41`，Extension ID 仍 `eehdadpmjffomabiedcjijiakconalab`，Chrome `service_worker_registration_info.version=0.1.41`。旧 `0.1.40` Background 证据已失效，不得再把 Chrome adoption 当当前 blocker。
32. 0.1.41 新接线已被真实 runtime 证明：Tasks `task.ensureWorkers` HTTP 200 后，Browser Carrier `TASK_OBSERVER_RECOVER` 记录 `SUCCEEDED`，随后 `execution.listSignals` 与 `task.projection` 均 `SUCCEEDED`。因此“Tasks mutation 成功后没有触发 Task Observer recovery”这一缺口已经关闭。
33. 当前 J3 失败发生在下一跳 `task.wake`：browser-observer 日志记录 `TASK_WAKE_NOT_CONFIRMED:FAILED:NOT_APPLIED`，Dev Conversation 没收到新的 `NODE_READY`。对应 Execution 为 `execution:fbc00b27-bf5b-4325-a3ef-4269579fdabd`，Execution Runtime 记录 `EXECUTION_REDECISION_REQUESTED → ADMISSION_REJECTED / IDENTITY_INVALID`。
34. 该 wake Execution 的 durable request 已独立读取：`callerRef=extension:task-observer`，`taskId=task-a6f859c00b1accd027d53d48`，`nodeId=dev`，`runNo=1`，Dev `roleRef` 与 `workerRef` 均与当前 Task Owner/TaskRoleBinding exact match；Dev Role 仍在 Agent Runtime 注册。REQUIREMENT 文档 Owner 路径 `.proflow/tasks/task-a6f859c00b1accd027d53d48/documents/requirement.md` 真实存在。
35. 当前高置信候选位于 Platform Host `authorizeExecution()`：对带 `nodeId/runNo` 的 Browser Execution，它调用 `task.queries.getNodeContext({ taskId, nodeId, ...(runNo ? { runNo } : {}) })`；但 Task Orchestration 的 `getNodeContext` 正式 schema 是 `z.object({ taskId, nodeId }).strict()`。若 strict validation 因多余 `runNo` 失败，`authorizeExecution` 外层 `catch { return false }` 会把真实合同错误压成统一 `IDENTITY_INVALID`，与现场完全吻合。
36. **但 35 目前只能写 HIGH-CONFIDENCE CANDIDATE，不能直接写 ROOT_CAUSE。** 用户明确要求：修改此身份门禁前，下一 Chat 必须先端到端通读 Task Orchestration，特别是 runNo/reopen fencing、Worker accept/startNode、Execution 与 Node scope、TaskRoleBinding vs node.workerRef、stale wake/stale execution rejection，再决定正确修法。禁止为了让 Real-3 过而删除 runNo fencing。
37. 前台扩展自动化规则已修正：旧“Extension ID + 名称 → 最小 AX card container → descendants action”正式 INVALID。Chrome 152 下该启发式曾误打开 `BOSS Agent Bridge` 的 Remove 确认，但二次目标校验立即 STOP，BOSS 未被删除。Extension ID + 名称以后只作为身份锚点，mutation 必须 fresh reality + 独立几何/位置验证，destructive action 必须原生确认框二次验身份。

### 尚未宣称证明的部分

- causal receipt 的自动化 proof 已完成，但未运行真实 Chrome；本次 stale observation 的**具体物理触发事件**（例如 tabId reuse、navigation/session residue 中哪一个）仍未用完整 Chrome tab 生命周期时间轴钉死，不能把某个候选写成 verified trigger。
- 三个既有 `UNKNOWN_SIDE_EFFECT` 仍没有 exhaustive negative evidence，也没有正式 operator resolution surface；禁止 Recover、改写或伪判 NOT_APPLIED。用户已明确选择保留这些事故 Execution，并通过固定 Role 新建/绑定新的人工 Worker Conversation 继续当前 Real-3，因此 legacy UNKNOWN 不再是本次 J1 的直接 blocker。

## FIXED_REAL3_RESOURCES

```text
Task = task-a6f859c00b1accd027d53d48
Title = Real-3 read-only smoke
Product role = g-6a97182669f88191a943e806a3e1b42a
Dev role = g-6a9717f68ef081918aacd5911916d2ec
Test role = g-6a97186190108191bc24fb85b2cff584
Product manual worker = 6a9b243c-7af8-83e9-a005-2ccfb8c5c8cb / OWNER BOUND EXACT, GETTASK PASS, REQUIREMENT OWNER V3
Dev manual worker = 6a9b4632-ca8c-83e9-a4bc-9de9e229e515 / OWNER BOUND EXACT, GETTASK PASS
Test manual worker = 6a9b8ae0-f694-83e8-b4a2-0d20cbc5c04a / OWNER BOUND EXACT, GETTASK PASS
Task current = ACTIVE / v7 / currentNodeId=dev / Dev READY run1 / Test PENDING run1 / J2 HUMAN START PASS
Product execution = execution:c3fc60b1-74fc-4cfb-bf45-c9ae18602631
Dev execution = execution:a510cb5d-2a65-419f-bd7e-254b9d77cdc4
Test execution = execution:567be187-f585-4d08-bb33-6fbe25e84aed
```

禁止创建新 GPT / Task / Execution。旧 worker.create UNKNOWN 原样保留，不 Recover、不改 DB。用户已授权在固定 Role 下创建新的人工 Worker Conversation；每个新人只有在正式 `browser.bindWorker` + Owner readback 后才算上岗完成。保留原始 Browser 事故现场，不点 Dev/Test 旧 Permission。

## NEXT_ACTION

1. 将本轮已请求的执行纪律 / Browser Harness 变更独立提交，使 release clean-tree gate 满足；不得和产品修复 commit 混合。
2. 正式 release `execution-browser-extension 0.1.44`；publish 后先 Registry exact readback，UNKNOWN 禁止盲重试。
3. Product Workspace 只更新 Extension 到 0.1.44；readback node_modules + materialized manifest。
4. Chrome 采用 0.1.44：遵守 fresh reality + 一次必要 mutation + immediate readback；不复用旧 AX card ancestor。
5. 回同一个 fixed Task/J3，确认 Provider/Model/Execution READY 后只执行一次正式 recovery；同一 durable wake 必须 `SUCCEEDED/APPLIED` 且 Dev Conversation 真正出现新 `NODE_READY` 才算 J3 PASS。
6. J3 PASS 后立即进入 J4：Dev startNode -> Execution 真读 `repos/proflow/package.json` -> Dev completeNode -> Test 自动 READY/NODE_READY -> Test startNode -> 独立真读 -> completeNode -> Owner Task SUCCEEDED/currentNodeId=null。

## STOP_POINT

当前 STOP POINT 是：`J1_PASS / J2_PASS / PLATFORM_READY / MODEL_READY / J3_IDENTITY_PASS / J3_OBSERVE_PASS / J3_COMPOSER_ROOT_CAUSE_VERIFIED / COMPOSER_FIX_D40D371_LOCAL_PASS / EXTENSION_0.1.44_RELEASE_PENDING / J3_DEV_NODE_READY_PENDING / J4_NOT_STARTED / LEGACY_UNKNOWN_PRESERVED / A4_BROWSER_TARGET_OWNERSHIP_DEFERRED`。禁止重建 Task/GPT/Worker、重新 Human Start、再次 WORKER_BIND/bind、修改 Owner DB；0.1.44 adoption 前不得再次 Recover。

## RECENTLY_CLOSED

```text
R3_PAIRING_0139 = CLOSED / SAME-SCENE REAL CHROME VERIFIED
FRESH_IMPORT_SYNTAX_ERROR = CLOSED
REGISTRY_AND_WORKSPACE_0139 = CLOSED / VERIFIED
```

以上 CLOSED 项没有新的可复现 regression evidence 不得重开。

## DO_NOT_REPEAT

- 不回到 0.1.38 historical Extension error / import bundle 路线。
- 不重复发布/update 已闭环的 `execution-browser-extension 0.1.41` 或 `model-runtime 0.1.24`；Registry/Workspace/Chrome runtime 已有 authority。
- 当前 `PLATFORM_READY=YES`、Model Runtime/Decision=READY；不得把 pairing、模型、Tunnel、Task Orchestration 重新拉回主线，除非出现新的可复现 regression evidence。
- 不创建新 Task/GPT/Execution，不复制第二份 Worker Conversation，不点旧 Permission，不 blind Recover legacy UNKNOWN。
- 不重新 Human Start，不直接 `task.start`，不再次 `WORKER_BIND/browser.bindWorker`。
- 当前 Browser Observer recovery 已 runtime-proven；不得因为 Dev 未收到 NODE_READY 就再次修改 Browser wake wiring，先处理 Execution identity admission。
- 不在完整 Task Orchestration/runNo fencing 审计前直接修改 `authorizeExecution`；尤其禁止删掉 runNo 校验或放宽 identity gate 只为跑通 Real-3。
- Browser side-effect/identity 异常必须 screenshot-first；不得先从源码猜，再回头补截图。

## REQUIRED_CONTEXT

完成 Core 读取后，当前 checkpoint 已切到 **execution-browser-extension 0.1.44 release/adoption + SAME-SCENE J3/J4**。下一 Chat 第一轮只额外读取当前动作真正需要的 Runbook：

1. `03-自动化知识库/基础动作/Chat-高吞吐本地工程执行.md`
2. `03-自动化知识库/流程/Package-Update-Loop.md`
3. `03-自动化知识库/基础动作/npm发布与Registry回读.md`
4. `03-自动化知识库/包能力/execution-browser-extension.md`
5. `03-自动化知识库/基础动作/Browser-UI自动化.md`
6. `03-自动化知识库/流程/Real3-J0-J4.md`
7. `03-自动化知识库/基础动作/Targeted-Gate.md`

其中 `Chat-高吞吐本地工程执行.md` 是任何后续源码修改的执行 owner：无论改 1 个还是多个文件，都统一走 `批量读 → 想清楚 → 批量写 → 统一验证`，不存在单文件特例。当前若只是 release / Registry / Workspace / Chrome adoption 机械动作，则按对应 Runbook 执行，不重新进入源码探索。

### ON_DEMAND_CONTEXT

- 只有 SAME-SCENE J3 再次回归到 `IDENTITY_INVALID / ADMISSION_REJECTED / generation mismatch`，才按需重读 `spec/任务与编排领域/` normative context；A1-A3 已真实 runtime PASS，禁止把整套 Task Orchestration 作为默认第一阅读域。
- MCP / Playwright / Local Dev runtime 异常 → `03-自动化知识库/基础动作/Tool-Runtime-gptweb-mcp.md`。
- 只有 CURRENT / active Runbook 无法解释某条旧 evidence 时才读 `90-历史记录`；历史 handoff 不参与当前默认裁决。

## CONTEXT_DRIFT_GUARD

进入下一重大动作前检查：CURRENT 的 authority、checkpoint、problem、`NEXT_ACTION[0]` 是否仍等于当前机械现实。任何一项落后：`SYNC CURRENT FIRST`。Event Trigger 即时写回，Round Closeout 只做第二道漏项检查。

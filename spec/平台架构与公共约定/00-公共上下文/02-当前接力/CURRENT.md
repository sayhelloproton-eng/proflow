# CURRENT｜Phase 3 当前接力

> 更新时间：2026-09-05。这里是下一 Chat 的唯一滚动执行入口；旧 handoff 只在 `90-历史记录`。

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
HEAD = 06fffc6 / chore(browser): scope privileged extension actions to card
working tree = WIP / model-runtime live-inventory remap fix + changeset + CURRENT; release preparation in progress
LOCAL_BROWSER_FIX_GREEN = YES / prior causal receipt candidate remains closed
J2_TASKS_WEB_FIX_GREEN = YES / self-contained Tasks web patch committed as 09d33aa
TARGETED_GATE = PASS / CP-EXE-BR-32 + CP-EXE-BR-33 = 4 of 4
PACKAGE_GATE = PASS / 156 of 156 tests
PACKAGE_TYPECHECK = PASS
ROOT_TYPECHECK = PASS
BUILD = PASS
SCOPED_BIOME_AND_DIFF_CHECK = PASS
BUILT_TASKS_SELF_CONTAINED = YES / dist/extension/tasks.js has no runtime import
RELEASE_COMMIT = 86ab99b / execution-browser-extension 0.1.40 version facts
Registry execution-browser-extension@0.1.40 = PRESENT / EXACT VERIFIED
Product Workspace execution-browser-extension = 0.1.40 / EXACT VERIFIED
materialized Chrome loadDir manifest = 0.1.40 / VERIFIED
Chrome loaded ProFlow Execution Browser = 0.1.40 / fresh reload-after chrome://extensions screenshot VERIFIED
Extension ID = eehdadpmjffomabiedcjijiakconalab / SAME ID VERIFIED
platform setup = 2/3 CORE STEPS COMPLETE / browser extension COMPLETE + remote connection RECOVERED; model-runtime still BLOCKED by MODEL_MAPPING_STALE
platform start = BLOCKED / exact reason: Provider model inventory 已变化，需要自动重新映射
MODEL_RUNTIME_FIX = LOCAL GREEN / targeted drift test RED→GREEN; package 67/67 PASS; package/root typecheck PASS; root build PASS; git diff --check PASS
MODEL_RUNTIME_RELEASE_PLAN = EXACT / only @tomflow/proflow-model-runtime 0.1.22 → 0.1.23 (patch); Registry 0.1.23 MISSING before release
Chrome 0.1.40 runtime = LOADED_VERSION_VISUALLY_PROVEN / reload-after screenshot shows 0.1.40 + same Extension ID
```

`PLATFORM_READY=NO` 当前不是 Browser Extension 回归，而是 update 后平台恢复时暴露的独立 `MODEL_MAPPING_STALE`。Browser Extension 0.1.40 已完成 Registry → Workspace → loadDir → Chrome loaded-version 四层对齐；Remote Connection 也已恢复。Real-3 J2 现在必须先让 Model Runtime 的自动 remap 真正闭环，使 `platform start` 恢复，再回 `ProFlow Tasks` SAME SCENE 验证 401 和 Human Start。

## CURRENT_CHECKPOINT

```text
REAL_3_J2_PLATFORM_RECOVERY_MODEL_RUNTIME_FIX_GREEN_RELEASE_NEXT
```

## CURRENT_PROBLEM

```text
problem class = REAL3_J2_PLATFORM_RECOVERY_MODEL_MAPPING_STALE + TASKS_WEB_SAME_SCENE_VERIFY_PENDING + GATEWAY_DIAGNOSTIC_COLLAPSE
primary current owner = @tomflow/proflow-model-runtime setup/remap boundary; browser Tasks fix remains awaiting SAME-SCENE proof after platform recovery
runtime boundary = Browser Extension 0.1.40 Registry/Workspace/loadDir/Chrome loaded all aligned; Remote Connection recovered; platform start currently blocked only by model-runtime MODEL_MAPPING_STALE
non-blocking diagnostic owner = @tomflow/proflow-agent-gateway
first reality = J1 已机械闭环：Product / Dev / Test 三个固定 Role 均 formal browser.bindWorker exact + getTask PASS；Task Owner 当前 READY/v6/readiness=true/canStart=true，三份 Role binding exact，两个 Node 仍 PENDING/currentNodeId=null
blocking reality = `model-runtime.status()` 读取 live Provider `/models` 能发现 inventory drift，但旧 `setup()` 先用 model-provider shared facts 算 fingerprint，若旧 mapping 与旧 shared facts 相等就 early-return，导致 `platform setup` 连续返回“全部模块均已就绪”而最终 status 仍 `MODEL_MAPPING_STALE`。targeted 回归已改为真实用户路径（不手工刷新 provider facts）并先 RED `mappingCalls 1 !== 2`；实现改为 setup 先读取 live inventory，用 live fingerprint 判断复用并用 live models remap，随后 targeted GREEN、package 67/67、package/root typecheck、root build、diff-check 全 PASS
release reality = Browser Extension 0.1.40 已真实 publish/update/load；Model Runtime 当前仍是 0.1.22，local fix 尚未发布。下一 release 必须只包含 model-runtime patch，目标 0.1.23
current stop point = model-runtime local candidate GREEN；先 changeset + release plan 确认唯一 release set 0.1.22→0.1.23，正式 publish/update 后运行 `platform setup` 证明自动 remap，再 `platform start`；只有平台恢复后才回 ProFlow Tasks SAME SCENE 验证 401 消失与 Human Start
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
27. 用户新增其它 Chrome Extension 后，ProFlow 卡片从原第二位置移动到第一排第三位置，暴露 `browser-extension-ui.swift` 旧 locator 的结构风险：旧 `reloadButtonAfterExtension()/removeButtonAfterExtension()` 是“找到名称后，在全局后续 AX 节点中取第一个 Reload/Remove”，虽不是固定坐标，但仍依赖全局顺序。helper 已改为 `Extension ID + 名称 → 最小目标卡片容器 → 仅卡片 descendants 内 Reload/Remove`，compile-only PASS；随后正式 Reload 返回 `BROWSER_UI_RESULT=RELOADED`，fresh reload-after screenshot 明确显示 ProFlow `0.1.40` + 同一 Extension ID，loaded-version 已闭环。
28. Browser update 后平台恢复暴露新的真实 blocker：Remote Connection 已从 1/3 恢复到 2/3，但 `platform start` exact 阻塞于 `MODEL_MAPPING_STALE`。连续 `platform setup` 都输出“全部模块均已就绪”却最终仍 2/3，源码/已安装 dist 对齐审计证明不是 CLI 版本漂移。
29. `MODEL_MAPPING_STALE` 根因已机械定位：`model-runtime.status()` 用 live Provider `/models` 检测 drift；旧 `model-runtime.setup()` 却先用 model-provider shared facts 计算 fingerprint，若旧 mapping 与旧 shared facts 相等就 early-return，因此真实 live drift 无法被 setup 自动修复。现有测试曾在 stale 后手工 `providerFacts(workspaceRoot, observed)`，替产品提前刷新 shared facts，掩盖了真实用户路径。回归已改为不手工刷新 provider facts，先 RED `mappingCalls 1 !== 2`；实现改为 setup 先读取 live inventory，用 live fingerprint 决定复用/重映射，并将 live models 传给原 mapInventory，targeted GREEN。全 package 67/67、package typecheck、root typecheck、root build、git diff --check 均 PASS。

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
Task current = READY / v6 / readiness=true / canStart=true / currentNodeId=null
Product execution = execution:c3fc60b1-74fc-4cfb-bf45-c9ae18602631
Dev execution = execution:a510cb5d-2a65-419f-bd7e-254b9d77cdc4
Test execution = execution:567be187-f585-4d08-bb33-6fbe25e84aed
```

禁止创建新 GPT / Task / Execution。旧 worker.create UNKNOWN 原样保留，不 Recover、不改 DB。用户已授权在固定 Role 下创建新的人工 Worker Conversation；每个新人只有在正式 `browser.bindWorker` + Owner readback 后才算上岗完成。保留原始 Browser 事故现场，不点 Dev/Test 旧 Permission。

## NEXT_ACTION

1. 为 `@tomflow/proflow-model-runtime` 创建唯一 patch changeset，先跑 `pnpm package:release --plan`；release set 必须只包含 `model-runtime 0.1.22 → 0.1.23`，若带出其它 package 立即 STOP。
2. 将 browser privileged helper/context hardening 与 model-runtime source/test/changeset 按逻辑提交，满足正式 release clean-tree 前置；随后执行一次正式 `package:release`。publish 超时/Registry propagation race 仍按 authority readback，禁止 blind republish。
3. Registry exact 证明 `model-runtime@0.1.23` 后，通过公开 `platform update --package @tomflow/proflow-model-runtime --workspace /Users/agent/Desktop/proton-workspace` 更新 Product Workspace；当前平台未启动，可直接走单包 update。然后运行 `platform setup --workspace ...`，要求 `MODEL_MAPPING_STALE` 消失、3/3 COMPLETE，再 `platform start`。
4. 平台恢复后只回 ProFlow Tasks SAME SCENE：screenshot + Console/DOM 证明 0.1.40 的 `/src/carrier-attention-view.js` 401 消失；再 Owner readback `READY/v6/canStart=true`。Human Start 只点击一次，ACT → screenshot/snapshot → Owner readback，验证 Task/currentNode/dev Node 正式推进后继续 J2/J3。

## STOP_POINT

当前 STOP POINT 是：`J1_PASS / TASK_READY_V6 / EXTENSION_0140_LOADED_PASS / REMOTE_CONNECTION_2_OF_3_RECOVERED / MODEL_MAPPING_STALE_ROOT_CAUSE_FIXED_LOCAL_GREEN / MODEL_RUNTIME_0123_RELEASE_NEXT / J2_HUMAN_START_NOT_YET / LEGACY_UNKNOWN_PRESERVED`。Product/Dev/Test 均禁止再次 WORKER_BIND/bind；禁止直接 task.start、Recover、创建第二笔 Execution、修改 Owner DB、重复发布 0.1.40 或再进入 Extension Manager。

## RECENTLY_CLOSED

```text
R3_PAIRING_0139 = CLOSED / SAME-SCENE REAL CHROME VERIFIED
FRESH_IMPORT_SYNTAX_ERROR = CLOSED
REGISTRY_AND_WORKSPACE_0139 = CLOSED / VERIFIED
```

以上 CLOSED 项没有新的可复现 regression evidence 不得重开。

## DO_NOT_REPEAT

- 不回到 0.1.38 historical Extension error / import bundle 路线。
- 不重复发布或 update 0.1.39；它已经是 Registry/Workspace 已验证事实。
- 不因当前 `PLATFORM_READY=NO` 就把已关闭 pairing root cause重新猜一遍；先完成当前 package candidate，再走公开 setup 恢复 live session。
- 不创建新 Task/GPT/Execution，不复制第二份 Worker Conversation，不点旧 Permission，不 blind Recover UNKNOWN。
- Browser side-effect/identity 异常必须 screenshot-first；不得先从源码猜，再回头补截图。
- 不把这次老缺陷借机升级成 Browser Carrier 大重构；只修当前可复现不变量。

## REQUIRED_CONTEXT

完成 Core 读取后，第一轮额外 active context：

1. `03-自动化知识库/基础动作/Browser-UI自动化.md`
2. `03-自动化知识库/基础动作/Chat-高吞吐本地工程执行.md`
3. `03-自动化知识库/包能力/execution-browser-extension.md`
4. `03-自动化知识库/流程/Package-Update-Loop.md`
5. `03-自动化知识库/基础动作/Targeted-Gate.md`
6. `03-自动化知识库/流程/Real3-J0-J4.md`

### ON_DEMAND_CONTEXT

- targeted GREEN 后需要发布 → `03-自动化知识库/基础动作/npm发布与Registry回读.md`。
- MCP / Playwright / Local Dev runtime 异常 → `03-自动化知识库/基础动作/Tool-Runtime-gptweb-mcp.md`。
- 只有 CURRENT/Runbook 无法解释某条旧 evidence 时才读 `90-历史记录`；正常换 Chat 不再创建新的 handoff + 提示词文件。

## CONTEXT_DRIFT_GUARD

进入下一重大动作前检查：CURRENT 的 authority、checkpoint、problem、`NEXT_ACTION[0]` 是否仍等于当前机械现实。任何一项落后：`SYNC CURRENT FIRST`。Event Trigger 即时写回，Round Closeout 只做第二道漏项检查。

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
HEAD = d8bac3eb2df72cc2817d2864405cef62cf85d323
Registry execution-browser-extension@0.1.39 = PRESENT / VERIFIED
Product Workspace execution-browser-extension = 0.1.39 / VERIFIED
Chrome ProFlow Execution Browser = 0.1.39 / VERIFIED
Extension ID = eehdadpmjffomabiedcjijiakconalab
platform status current readback = PLATFORM_READY=NO
status reason = Chrome 扩展已加载，但当前运行会话未在线；公开恢复入口仍是 platform setup
```

`PLATFORM_READY=NO` 是当前 live-session readback，不反向重开已经真实通过的 0.1.39 pairing 修复。当前 package repair 尚未形成新发布候选，先完成代码 Gate，再恢复 runtime。

## CURRENT_CHECKPOINT

```text
REAL_3_J1_BROWSER_IDENTITY_REPAIR
```

## CURRENT_PROBLEM

```text
problem class = BROWSER_IDENTITY_LIFECYCLE / PACKAGE_REPAIR
owning package = @tomflow/proflow-execution-browser-extension
first reality = 已取得固定 Product / Dev / Test Browser 错位证据；后续真实复验仍必须 screenshot-first
current stop point = 最小修复 RED→GREEN；GREEN 前不 bump / publish / update / Recover
```

### 已确认事实

1. 0.1.39 pairing 原 blocker 已真实关闭：`hello 200 → carrier/attentions 200 → commands/next 204 → heartbeat 200`，`platform setup` 曾完成 3/3。
2. fresh `Cannot use import statement outside a module` 没有复现；旧 Extension error 不再是当前 root cause。
3. 三个 `worker.create` Owner request 的 roleRef / roleUrl 正确；不是 Task/Role Owner 生成错请求。
4. 真实 Browser 旧失败现场发生角色错位：Product 的 `WORKER_BIND` 进入 Dev Conversation，Dev 的进入 Test Conversation，Test 的留在 Product root composer draft。
5. 当前实现存在结构缺口：Background `OPEN` 可按 tabId 接受 session observation 而缺少本次 OPEN freshness/target identity proof；`worker.create` 历史顺序允许在最终 role identity 校验前进入 durable effect / submit；slugged Custom GPT Conversation URL 需要 canonical role identity 后才能和 Owner truth reconciliation。
6. Git 历史已确认这些核心缺口不是 2026-09-04 `2e6bbd8 refactor(browser): harden Real-3 carrier reality` 新引入：`worker.create` / parser 可追到 2026-08-13 `f3099347`，`OPEN → waitForObservation(tabId)` 可追到 2026-08-13 `8f25100a`。最近重构使真实长生命周期/recovery 条件把旧缺陷暴露出来。
7. 新回归已经 RED：slugged role identity 与 wrong-role OPEN-before-effect 两类约束命中；当前 working tree 正在做最小修复，尚未完成 GREEN/full package validation。

### 尚未宣称证明的部分

- 本次 stale observation 的**具体物理触发事件**（例如 tabId reuse、navigation/session residue 中哪一个）尚未用完整 Chrome tab 生命周期时间轴钉死。结构性 fail-safe 缺口已经足够支持最小修复，但不得把某个触发猜测写成已证实根因。
- Background `OPEN` freshness + target identity 修复尚未完成 targeted GREEN；不能发布下一版本。

## FIXED_REAL3_RESOURCES

```text
Task = task-a6f859c00b1accd027d53d48
Title = Real-3 read-only smoke
Product role = g-6a97182669f88191a943e806a3e1b42a
Dev role = g-6a9717f68ef081918aacd5911916d2ec
Test role = g-6a97186190108191bc24fb85b2cff584
Product execution = execution:c3fc60b1-74fc-4cfb-bf45-c9ae18602631
Dev execution = execution:a510cb5d-2a65-419f-bd7e-254b9d77cdc4
Test execution = execution:567be187-f585-4d08-bb33-6fbe25e84aed
```

禁止创建新 GPT / Task / Execution。旧 worker.create 已进入 UNKNOWN，TaskRoleBinding 仍不能靠 blind replay 补齐。保留原始 Browser 现场，不点 Dev/Test 旧 Permission，不手工修 Chat，不第二次盲 Recover。

## NEXT_ACTION

1. 只在 `execution-browser-extension` 完成当前最小修复：统一 canonical carrier identity；`OPEN` 只接受本次操作后的 fresh + target-matching observation；`worker.create` 在 `EFFECT_STARTED / SUBMIT` 前验证 opened identity。
2. 先跑新增 targeted regressions，随后 package typecheck / affected tests；失败只围绕当前行为继续，不扩成架构重构。
3. GREEN 后做一次 diff/blast-radius 审计。由于 Registry 已存在 0.1.39，只有修复候选稳定后才按 release sync 产生下一版本（不得覆盖/重复发布 0.1.39）。
4. 发布必须走真实 npm Registry → exact readback → Product Workspace `platform update --package`；不使用 local link/tarball/source override。
5. 更新真实 Extension 后，执行 `platform setup` 恢复 live session；用原固定 Browser 工作集重放 J1。每个关键 OPEN/SUBMIT 后 screenshot + URL/DOM，随后回读 Owner/Execution。
6. J1 只在三个固定 Role 各形成正确原始 Conversation、真实正确 `WORKER_BIND` user message、TaskRoleBinding 与 Browser reality 一致且零新增 UNKNOWN 后 PASS；然后继续 J2。

## STOP_POINT

当前 STOP POINT 是：`OPEN identity/freshness + worker.create pre-effect guard` targeted GREEN。GREEN 前禁止版本发布和真实副作用重放。

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

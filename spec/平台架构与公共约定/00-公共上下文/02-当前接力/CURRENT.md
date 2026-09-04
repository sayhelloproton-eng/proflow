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
HEAD = e02c130fd182b791b57ffe509d1c8dfbb6a4da60
working tree = 5-file scoped WIP against e02c130; not committed
LOCAL_BROWSER_FIX_GREEN = YES / strict causal receipt candidate
PACKAGE_GATE = PASS / 155 of 155 tests + package typecheck
ROOT_TYPECHECK = PASS
BUILD = PASS
SCOPED_BIOME_AND_DIFF_CHECK = PASS
NEEDS_REAL_RELEASE = NO / Browser candidate controller audit accepted; UNKNOWN continuation still requires user decision
Registry execution-browser-extension@0.1.39 = PRESENT / VERIFIED
Product Workspace execution-browser-extension = 0.1.39 / VERIFIED
Chrome ProFlow Execution Browser = 0.1.39 / VERIFIED
Extension ID = eehdadpmjffomabiedcjijiakconalab
platform status current readback = PLATFORM_READY=NO
status reason = Chrome 扩展已加载，但当前运行会话未在线；公开恢复入口仍是 platform setup
```

`PLATFORM_READY=NO` 是当前 live-session readback，不反向重开已经真实通过的 0.1.39 pairing 修复。当前 Browser candidate 已完成自动化 Gate，但尚未获得发布授权，不能据此恢复 runtime。

## CURRENT_CHECKPOINT

```text
REAL_3_J1_BROWSER_IDENTITY_CAUSAL_REPAIR_AND_UNKNOWN_CONTINUATION_DECISION
```

## CURRENT_PROBLEM

```text
problem class = BROWSER_IDENTITY_LIFECYCLE + EXECUTION_UNKNOWN_CONTINUATION_GAP
primary owning package = @tomflow/proflow-execution-browser-extension
secondary owner for continuation gap = @tomflow/proflow-execution-runtime / execution contracts
first reality = 已取得固定 Product / Dev / Test Browser 错位证据；后续真实复验仍必须 screenshot-first
current stop point = Browser causal candidate 已自动化全绿；三个既有 UNKNOWN 均仍不能机械判 NOT_APPLIED，最小 continuation 方案 C 需要用户授权 Public API 边界，禁止 bump / publish / update / Recover
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
13. 最小完整 continuation 方案为 C：增强 `worker.create` verifier 仅在 exhaustive negative evidence 下返回 `NOT_APPLIED`，并增加 Execution-owned、认证且可审计的 Human/operator resolution surface 处理无法机械收敛的 legacy UNKNOWN。前者是 implementation gap；后者涉及 Public API，未经用户裁决不得实现。

### 尚未宣称证明的部分

- causal receipt 的自动化 proof 已完成，但未运行真实 Chrome；本次 stale observation 的**具体物理触发事件**（例如 tabId reuse、navigation/session residue 中哪一个）仍未用完整 Chrome tab 生命周期时间轴钉死，不能把某个候选写成 verified trigger。
- 三个既有 `UNKNOWN_SIDE_EFFECT` 目前没有 exhaustive negative evidence，也没有正式 operator resolution surface，不能合法继续；该 gap 必须与 Browser correctness patch 分批处理，不能为了继续 J1 直接改 DB 或创建第二笔 Execution。

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

1. 总控已完成 baseline `e02c130` → 当前 5-file WIP 审计，并独立重跑 critical proofs `24/24 PASS` + `git diff --check PASS`；Browser causal candidate 接受为本地候选，但仍未 commit、bump、publish 或跑真实 Chrome。
2. 用户裁决 continuation 方案 C 的 Public API 边界；未经授权不得实现 operator resolution，也不得把当前 tab 零候选直接等同 exhaustive `NOT_APPLIED`。
3. Browser patch 与 UNKNOWN continuation patch 保持分批；只有固定三条 UNKNOWN 有合法 continuation 后，才决定 release package set 与顺序并回 SAME SCENE。

## STOP_POINT

当前 STOP POINT 是：`BROWSER_CAUSAL_CANDIDATE_GREEN / NO_RELEASE_AUTHORIZATION / OPERATOR_RESOLUTION_PUBLIC_API_DECISION_REQUIRED`。禁止 bump/publish/update/Recover、创建第二笔 Execution、修改 Owner DB 或清理旧 Browser evidence。

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

# Phase 3 / Real-3 Audit｜Wave 21｜Final Acceptance / Gate

日期：2026-09-13
状态：BLOCKED_ON_FINAL_RUNTIME_ADOPTION

## Scope

本 Wave 重建正式 `DDD invariant → SDD design → TDD case → automated proof → runtime evidence → human acceptance` traceability，并按证据 authority 区分“当前源码/包事实”“Real-3 真实历史运行事实”与“最终已发布版本的当前运行态”。

本 Wave 不以源码存在、单元测试绿色、Registry 发布成功替代最终 Runtime / Browser / Human owner evidence；也不为了刷新时间戳重新创建 Task、Worker 或 Conversation。

## Authority Classes

- `CURRENT_SOURCE`：当前 main 源码、canonical spec、TDD、tests 与本轮 committed audit truth。
- `CURRENT_PACKAGE_REGISTRY`：npm Registry exact version 与 main 中已消费 release facts。
- `REAL3_HUMAN`：固定 Real-3 Task 经真实 ChatGPT / Browser / Worker / Owner 路径得到的真人验收事实。
- `CAPTURE_TIME_RUNTIME`：当时正式 install/setup/start/status 与 Chrome/Host/Role reality；只能证明捕获时运行版本。
- `PENDING_CURRENT_RUNTIME`：最终发布版本尚需正式 adoption/readback 才能建立的当前运行态事实。

## Current Calibration

```text
main HEAD before this Wave = df9b58311623de97ec31885992fa7a180aed7ed7
Wave 01..20 = DONE
Real-3 Task = task-real3-final-autowake-20260912 / SUCCEEDED v11
Dev = real3-dev-20260912 / SUCCEEDED / run 1
Test = real3-test-20260912 / SUCCEEDED / run 2
Test REOPEN = original TaskRoleBinding / Worker / Conversation reused
```

当前正式 release facts：

```text
@tomflow/proflow-agent-gateway = 0.1.19
@tomflow/proflow-agent-product = 0.1.19
@tomflow/proflow-execution-browser-extension = 0.1.63
@tomflow/proflow-platform-host = 0.1.30
@tomflow/proflow-task-orchestration = 0.1.12
```

五个 exact npm Registry target 均已机械确认存在；不得重复 publish。

## Traceability Matrix

| Critical invariant | DDD / SDD | TDD | Automated proof | Runtime / Human proof | Final authority |
|---|---|---|---|---|---|
| TaskRoleBinding transient three-state / bounded DEFER | Task/Carrier binding 只允许 exact transient incomplete binding 进入 DEFER；partial/conflict/timeout fail-closed | Permission binding race / Host permission policy | `permission-binding-race.test.ts` + `browser-permission-policy.test.ts` | Real-3 真实 Permission/binding 链已通过 | `REAL3_HUMAN=PASS`; final package runtime `PENDING_CURRENT_RUNTIME` |
| Human Deny occurrence-scoped suppression / restart guard | Deny 只抑制当前 occurrence 下一次 matching continuation，不写 Task/Execution/Approval | `CP-EXE-BR-29`, `RF-EXE-BR-25` | `carrier-human-deny-recovery.test.ts` | Real-3 Carrier 自动化 Gate 已真实覆盖 Deny precedence/restart guard | `REAL3_HUMAN=PASS`; final package runtime `PENDING_CURRENT_RUNTIME` |
| Attention occurrence identity / restart reconstruction / authenticated relay | occurrence ref 独立、replacement stale、restart 主动 re-observe、`/tasks` authenticated relay | `CP-EXE-BR-30/31/32` | `carrier-attention-restart.test.ts`, `carrier-permission-attempt.test.ts`, `carrier-attention-web-bridge.test.ts` | Real-3 真实 Browser/Carrier 路径已消费 | `REAL3_HUMAN=PASS`; final package runtime `PENDING_CURRENT_RUNTIME` |
| Dev complete → Test READY durable handoff | backend Reconciliation 读取 durable Owner facts + bounded catch-up；Extension event 仅 kick | `CP-TASK-ORCH-14`, `CP-HOST-19` | `task-reconciliation.test.ts` + Task observer/journey tests | Real-3 Dev run1 complete 后 Test 被正式唤醒并最终 complete | `REAL3_HUMAN=PASS`; final package runtime `PENDING_CURRENT_RUNTIME` |
| REOPEN reuses original Worker / Conversation and advances generation | run-local workerRef 清除；TaskRoleBinding 保留；runNo+1 后重解同 Worker | `CP-TASK-ORCH-05/13`, `CP-AGT-DEV-10`, `CP-AGT-TEST-10` | Task SQLite integration + observer contract + Dev/Test journey tests | Test run2 复用原 workerRef `6aa2b749-87f4-83e8-bc7f-929161400e39`，无 duplicate Worker | `REAL3_HUMAN=PASS`; owner fact `PASS` |
| Permission liveness / watchdog / retry / action / final page reality | ordinary nonconsequential；unexpected Permission 才走 Carrier recovery；action outcome 与 final page reality correlation | `CP-EXE-BR-43..49` | CP43..48 已绑定 behavior tests；Wave06 将 timer/log seam 升级到 production-helper behavior；Wave10 补 final reality correlation | CP49 只接受真实 Chrome SAME_SCENE；Real-3 已存在真实 Chrome SAME_SCENE 证据 | `REAL3_HUMAN=PASS`; final 0.1.63 runtime `PENDING_CURRENT_RUNTIME` |
| Slugged GPT URL + current Role/version validation | restore 使用 durable locator；真实 `g-<roleRef>-<slug>` 合法；Role drift fail-closed 并在正式 adopt 后 re-read | `CP-HOST-22/23` | `browser-permission-policy.test.ts` | Real-3 使用真实 slugged Conversation；旧 installed baseline Role verify 曾 PASS | historical/current design `PASS`; final package runtime `PENDING_CURRENT_RUNTIME` |
| Direct Tool independence / provider child isolation | Repomix/Local Dev/CodeGraph 走 Extension Local Tool lane，不进入 Execution lifecycle | Host/Gateway/Execution Local/Execution Runtime Direct Tool gates | `direct-tools.test.ts`、Host/Gateway/Role package tests、Real-3 targeted regression | Test run2 独立取得 Repomix / CodeGraph / Local Dev 成功事实 | `REAL3_HUMAN=PASS`; final package runtime `PENDING_CURRENT_RUNTIME` |
| UNKNOWN no-blind-replay / terminal stop-driving | UNKNOWN 先 reality reconciliation；terminal Task 不再主动业务 WAKE | `CP-EXE-BR-09`, `CP-TASK-ORCH-13/17`, Browser terminal guard | Task observer + Browser carrier journey + Direct Tool UNKNOWN regressions | Real-3 owner failure经正式 fail→REOPEN 恢复；Task terminal `SUCCEEDED v11/currentNodeId=null` | Owner/human `PASS`; final package runtime `PENDING_CURRENT_RUNTIME` |

## Findings

### W21-F01｜PASS｜设计到自动化 proof 无新的缺口

Wave 01～20 已把 Real-3 暴露的关键 failure families 上收到 canonical DDD/SDD/TDD，并绑定到真实 executable tests。W21 未发现需要重新设计领域模型、重新引入旧 Observer、重复 Worker、Always-Allow 主链或 GPT-facing Execution lifecycle 的理由。

### W21-F02｜PASS｜Real-3 真人 Journey 证据有效，但属于已完成运行事实

固定 Task 已由正式 Owner facts证明 `SUCCEEDED v11`；Test 经 `FAILED → REOPEN → START → COMPLETE` 到 run2，原 Task-bound Test Worker/Conversation 被复用；Dev→Test durable WAKE、三 Direct Tool 独立验证、真实 Permission/Carrier 路径均有对应事实。

这些证据足以证明 Real-3 产品 Journey 当时真实通过，不需要为了 W21 再创建 Task/Worker/Conversation。

### W21-F03｜PASS｜最终语义包已经正式发布并回写 main release facts

五个目标版本已存在于 npm Registry；main 已通过 release-facts commit 消费 changeset并记录相同版本。发布成功不等于运行态 adoption，因此这里只关闭 `CURRENT_PACKAGE_REGISTRY` 层。

### W21-F04｜BLOCKER｜最终 release 的 current runtime adoption 尚未被本审计证明

Wave 14 的 capture-time runtime baseline 曾证明 Platform READY，但其版本是：

```text
Extension 0.1.62
Host 0.1.29
Gateway 0.1.18
Product 0.1.18
Execution Runtime 0.1.19
Dev Tunnel 0.1.36
Dev/Test 0.1.21
```

当前最终发布版本已前进到 Browser `0.1.63`、Host `0.1.30`、Gateway `0.1.19`、Product `0.1.19`、Task Orchestration `0.1.12`。本 Wave 没有当前正式 install/setup/start/status + Chrome/Role/Owner readback，因此不能把旧 capture-time READY 或 Registry publish 冒充最终 source→runtime parity。

这不是新的 implementation defect；它是 Final Gate 的 **runtime adoption evidence gap**。

## Required Final Runtime Acceptance

只有在明确获得 install/setup/start/restart 授权后，按正式产品路径完成以下最小证明：

1. 正式 install / adoption 采用 Registry exact final versions，不手改 `node_modules`、materialized runtime 或 durable Owner store。
2. 正式 setup/start/status 证明 Platform READY，且 timeout/UNKNOWN 先 reconcile，不重复启动第二实例。
3. package-owned verify 读取当前 installed/module/Role facts。
4. Chrome actual Manifest / materialized Extension / verification evidence 证明 Browser `0.1.63` 已采用，不能只看 source package.json。
5. Host/Gateway/Task/Role current owner facts 与 final package versions一致。
6. 对最终 release 触及的 Browser/Permission/identity/reconciliation 路径做最小 `SAME_SCENE` / `FAST_REPLAY`，不得无理由重跑整套 Real-3 Full Fresh。
7. 所有真实 Acceptance mutation 服从共享 Acceptance Skill，并使用 paired `AUTOMATION_START/AUTOMATION_RUN`。

## Gate Verdict

```text
TRACEABILITY_DESIGN = PASS
AUTOMATED_PROOF = PASS
REAL3_HUMAN_JOURNEY = PASS
PACKAGE_RELEASE = PASS
CURRENT_RUNTIME_ADOPTION = PENDING
WAVE21 = BLOCKED_ON_FINAL_RUNTIME_ADOPTION
PHASE3_FINAL_GO = NO
```

Wave 22 必须等待 W21 current runtime adoption Gate 收口后再进入；严格保持 01→22 顺序，不以性能审计绕过最终运行态证明。

## Boundary

本 Wave 仅冻结 traceability / Gate 结论，不执行 install、setup、start、restart、deploy，也不新建 Task/Worker/Conversation。当前用户已授权阶段性 commit，但未在本轮明确授权最终 runtime adoption mutation；因此停止在授权边界是正确结果，不是失败。

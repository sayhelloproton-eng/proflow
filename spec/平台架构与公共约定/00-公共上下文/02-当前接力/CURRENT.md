# CURRENT｜Phase 3 当前接力

> 更新时间：2026-09-07。这里是下一 Chat 的唯一滚动执行入口；历史过程见 `90-历史记录/Real3/`。

## CURRENT_STAGE

```text
ARCHITECTURE = FROZEN
REAL_1 = PASS
REAL_2 = PASS / FROZEN
DEPLOYMENT_SUCCESS = YES / FROZEN
J1 = PASS
J2 = PASS
J3 = PASS
J4 = PAUSED_FOR_INTEGRATION_HARDENING
REAL_3 = NOT_PASS
PHASE3_FINAL_GO = NO
CURRENT_EXECUTION_MODE = REAL_3_J4_DIAGNOSTIC
```

0.1.49 的真实 SAME-SCENE 复验再次暴露阻塞：production bridge 已重连并在线，但 Observer recovery 没有产生首个可见 application event。当前已退出“边验边发 patch”模式，进入有限 Integration Hardening 诊断；**0.1.50 尚未获得发布准入。**

## CURRENT_AUTHORITY

```text
branch = main
HEAD = 6e9b51a chore(release): version execution-browser-extension
source fix = 5464f7d fix(browser): rearm observer recovery on bridge reconnect
Registry exact @tomflow/proflow-execution-browser-extension@0.1.49 = PASS
Product Workspace installed = 0.1.49
materialized manifest = 0.1.49
Chrome registered Service Worker = 0.1.49
Extension ID = eehdadpmjffomabiedcjijiakconalab
verification.moduleVersion = 0.1.49
verification.evidenceSource = PAIRING_HEARTBEAT
platform setup = 3/3 PASS / PLATFORM_READY=YES
```

0.1.49 已完成 package → Registry → Workspace → materialized loadDir → Chrome registered Service Worker → browser-attested verification 的真实 adoption；不得再把版本采用问题重新当当前 blocker。

## FIXED_REAL3_TRUTH

```text
Task = task-a6f859c00b1accd027d53d48
Task status = ACTIVE
Task version = 10
currentNodeId = dev

Dev role = g-6a9717f68ef081918aacd5911916d2ec
Dev worker = 6a9b4632-ca8c-83e9-a4bc-9de9e229e515
Dev status = IN_PROGRESS
Dev runNo = 1

Test role = g-6a97186190108191bc24fb85b2cff584
Test role binding worker = 6a9b8ae0-f694-83e8-b4a2-0d20cbc5c04a
Test status = PENDING
Test runNo = 1

Product role/worker = g-6a97182669f88191a943e806a3e1b42a / 6a9b243c-7af8-83e9-a005-2ccfb8c5c8cb
```

正式 same-run resume 已完成，durable `TASK_RESUMED = task-event:10`。不得再次 ACK、resume 或 reopen。

原 durable wake 必须继续复用：

```text
executionRef = execution:e9b9c020-bfe2-4d85-8a17-e3c4a0b7a2c0
idempotencyKey = task-observer-wake:task-a6f859c00b1accd027d53d48:dev:1:TASK_RESUMED:task-event:10
status = FAILED
sideEffectState = NOT_APPLIED
attemptCount = 1
error = PRECONDITION_FAILED / WAKE_TRIGGER_TYPE_INVALID
```

0.1.49 runtime 复验前后 execution identity / idempotency / inputFingerprint / updatedAt 均未变化，没有 redecision。

## CURRENT_PROBLEM_CLASS

```text
class = REAL3_OBSERVER_RECOVERY_POST_RECONNECT
runtime_version_proven = YES / 0.1.49
bridge_reconnect_proven = YES
observer_rearm_reality = FAIL
same_execution_redecision = FAIL
root_cause = NOT_PROVEN
hotfix_0.1.50_admitted = NO
```

## CURRENT_FIRST_EVIDENCE

Codex 在 2026-09-07 只执行一次正式 `platform start`：`成功 4 / 跳过 19 / 失败 0`。启动前冻结 Browser Extension 日志 5041 行、Execution Runtime 日志 4292 行；启动后被动观察 20 秒，无人工 recovery/wake/browser mutation。

```text
BRIDGE_MODULE_VERSION = 0.1.49
BRIDGE_SESSION_ONLINE = YES
COMMAND_CONSUMER_READY = YES
Chrome ↔ 新 production bridge = ESTABLISHED
new execution.listSignals = NONE
new task.projection = NONE
new task.wake = NONE
REDECISION_EVENT = NONE
```

production bridge listener 属于本次新 `platform start` 进程，当前 Extension session 已在线，因此本次 start 后新 hello/reconnect epoch 已被现实证明发生。FIRST_DIVERGENCE 只冻结到：

```text
new production bridge hello/reconnect epoch = YES
→ expected Observer recovery activity
→ first visible Observer application completion event = NONE
```

## CURRENT_CANDIDATES

只允许区分以下三个候选，不得提前选择：

```text
A. reconnect epoch 成功，但 rearm callback 根本没有调用
B. rearm callback 调用，但复用长期未完成的 observerRecoveryInFlight，新 epoch 被吸收
C. recovery 已进入，但卡在 collaborationCarrier.recoverPending / collaboration.listPending 等首个无界 application await
```

`B/C` 当前只是 HYPOTHESIS；不得据此修改代码或发布 0.1.50。

## NEXT_ACTION

1. read-only 恢复当前 runtime/start-owner；不得重复 `platform start`。
2. 只为 A/B/C 区分读取 0.1.49 `rearm controller → runObserverRecovery → observerRecoveryInFlight → collaborationCarrier.recoverPending → execution.listSignals` 的 exact control flow。
3. 优先找既有 structured logs、Host request log、Service Worker console/可观察状态；不要先新增 instrumentation。
4. 若现有 evidence 能区分，冻结唯一 FIRST_DIVERGENCE + owning code path + causal regression，再把完整实现/测试/release 批次交给 Codex。
5. 若现有 evidence 机械上无法区分，报告 `EVIDENCE_GAP`；只准设计最小诊断 seam，不得直接修候选逻辑。
6. 只有 `CURRENT_ROOT_CAUSE=PROVEN` 后才允许一次 0.1.50 patch，并一次审计同 ownership domain 的相邻 reconnect/recovery failure matrix。
7. 修复后回同一 `execution:e9...`；same execution redecision PASS 后才恢复 Dev `file.read → Test → Task SUCCEEDED`。

## EXECUTION_SPLIT

```text
网页总控 Chat = Reality / authority / FIRST_DIVERGENCE / patch admission / SAME-SCENE final acceptance
Codex = 已冻结任务的源码分析、实现、tests/typecheck/build/governance/release、机械 runtime evidence collection
```

给 Codex 只提供 repo path、checkpoint、允许范围、验收条件和 STOP POINT；不要求它使用 CodeGraph / Repomix / Local Dev MCP。

## PATCH_TRAIN_GUARD

最近 50 个 commit：release 类 19（38%）、fix 17（34%）、docs 9（18%）；execution-browser-extension 触碰 28/50；四天内 Extension 从 0.1.37 连续到 0.1.49。Real-3 已事实性漂移成 Integration Hardening，因此冻结：

```text
0.1.49 = CURRENT_RC / REALITY_FAIL
0.1.50 = NOT_ADMITTED
Final Real Gate != Integration Hardening
```

不阻塞 `Observer → same execution → Dev → Test → SUCCEEDED` 的问题全部 backlog。

## DO_NOT_REPEAT

- 不重开 0.1.45～0.1.48 Browser adoption、Tunnel、TASK_RESUMED allowlist 等已闭环问题。
- 不重复 `platform setup/start/update` 作为诊断循环。
- 不 reload Extension / Chrome。
- 不人工发 `TASK_OBSERVER_RECOVER`、`task.wake`、Execution retry。
- 不再次 task.resume / ACK / reopen；不新建 Task、Worker、GPT、Execution。
- 不直接写 SQLite、roles registry、verification、node_modules 或 durable Owner state。
- 不因为发现真实 defect 就立即 release；`VALID_DEFECT != CURRENT_ROOT_CAUSE`。
- 没有 A/B/C 唯一 root cause 证明就没有 0.1.50 发布准入。
- 不 push。

## REQUIRED_CONTEXT

1. `03-自动化知识库/基础动作/Chat-高吞吐本地工程执行.md`
2. `03-自动化知识库/基础动作/Browser-UI自动化.md`
3. `03-自动化知识库/基础动作/Round-PID-Log与恢复.md`
4. `03-自动化知识库/流程/Real3-J0-J4.md`
5. `90-历史记录/Real3/24-Real3执行效率与证据链教训-20260907.md`
6. `90-历史记录/Real3/25-Real3-0.1.49真实复验失败与当前Chat交接-20260907.md`

## STOP_POINT

`0.1.49_RELEASE_PASS / WORKSPACE_PASS / CHROME_ACTUAL_ADOPTION_PASS / PLATFORM_READY_PASS / PLATFORM_START_PASS / BRIDGE_RECONNECT_PASS / OBSERVER_EVENT_NONE / SAME_EXECUTION_UNCHANGED / ROOT_CAUSE_NOT_PROVEN / J4_PAUSED_FOR_INTEGRATION_HARDENING / 0.1.50_NOT_ADMITTED`。

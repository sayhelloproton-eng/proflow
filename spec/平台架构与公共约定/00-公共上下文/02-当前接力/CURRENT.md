# CURRENT｜Phase 3 当前接力

> 更新时间：2026-09-13。这里是下一 Chat 的唯一滚动 **ProFlow 项目事实**入口；历史 acceptance、旧 adoption 现场、旧 repair worktree、capture-time evidence 状态与旧 blocker 不拥有当前 authority。精确 Git/runtime 事实仍必须在执行时机械读取。

## CURRENT_STAGE

```text
ARCHITECTURE = FROZEN
REAL_1 = PASS
REAL_2 = PASS / FROZEN
DEPLOYMENT_SUCCESS = YES / FROZEN
REAL_3_PRODUCT_JOURNEY = TERMINAL_SUCCEEDED
REAL_3_FINAL_AUDIT = WAVE21_BLOCKED_ON_FINAL_RUNTIME_ADOPTION
PHASE3_FINAL_GO = NO
CURRENT_EXECUTION_MODE = WAVE21_FINAL_ACCEPTANCE_GATE
```

`REAL_3_PRODUCT_JOURNEY = TERMINAL_SUCCEEDED` 只表示固定 Real-3 Task 已沿正式 Owner/Worker/Carrier 路径走到终态；最终已发布审计版本仍需 current runtime adoption proof。Registry publish、源码测试或历史 Runtime READY 均不能单独升级为 Phase 3 Final GO。

## CURRENT_AUTHORITY

```text
main repo = /Users/agent/Desktop/proton-workspace/repos/proflow
main branch = main
exact HEAD/status = READ_FROM_GIT_AT_EXECUTION_TIME
active audit plan = docs/audits/phase3-real3-full-chain-audit-plan-2026-09-13.md
Wave 01..20 = DONE
Wave 21 = BLOCKED_ON_FINAL_RUNTIME_ADOPTION
next executable wave = 21 Final Runtime Adoption Closure
Wave 22 = NOT_STARTED / ORDER_BLOCKED_BY_WAVE21
```

阶段 commits：

```text
3b9dc12 audit(real3): close full-chain waves 01-20
df9b583 chore(release): record Real-3 audit package facts
942184e audit(real3): freeze Wave 21 runtime adoption gate
```

2026-09-11 repair worktree、旧 S1/F02 pending 与旧 baseline 只属于历史过程，不再是当前入口或 blocker。

## SHARED_PROTOCOLS

```text
LOCAL_ENGINEERING
= /Users/agent/Desktop/proton-workspace/skills/chat-local-engineering-protocol/SKILL.md

ACCEPTANCE_AUTOMATION
= /Users/agent/Desktop/proton-workspace/skills/chat-local-acceptance-automation-protocol/SKILL.md
```

本文件只定义产品事实、checkpoint 与项目级授权边界。工程 mutation/verify 服从 Engineering Skill；真实 Browser/CLI/runtime acceptance 服从 Acceptance Skill。

## REAL3_TERMINAL_OWNER_FACTS

```text
Task = task-real3-final-autowake-20260912
Task status = SUCCEEDED v11
currentNodeId = null
Dev node = real3-dev-20260912 / SUCCEEDED / run 1
Test node = real3-test-20260912 / SUCCEEDED / run 2
Test workerRef = 6aa2b749-87f4-83e8-bc7f-929161400e39
REOPEN = reused original Test TaskRoleBinding / Worker / Conversation
```

Test run2 独立取得 Repomix / CodeGraph / Local Dev 成功事实并正式 `completeNode`。Real-3 真实 Browser/Carrier 证据包括 Permission classification/recovery、same-worker REOPEN、durable Dev→Test WAKE 与 terminal owner truth。不要为了刷新时间戳重新创建 Task/Worker/Conversation。

## REAL3_CLOSED_BLOCKERS

以下均已从 current implementation blocker 降为正式已解决 defect/provenance，并已有 canonical design + automated proof + Real-3 evidence：

- TaskRoleBinding transient 三态与 bounded `DEFER`；
- human Deny occurrence-scoped suppression / restart guard；
- Carrier Attention occurrence identity、restart reconstruction 与 authenticated `/tasks` 双向 relay；
- Dev complete → Test READY backend bounded reconciliation / WAKE；
- REOPEN → 原 Test Worker/Conversation；
- Role package adoption/version drift 与 slugged Custom GPT Conversation URL；
- Repomix / Local Dev / CodeGraph Direct Tool 独立执行与 provider child isolation；
- terminal Task stop-driving / UNKNOWN no-blind-replay。

它们在最终发布版本上的 compatibility 仍需 Wave21 final runtime adoption Gate 验证，但不得重新变成实现 TODO。

## FINAL_RELEASE_FACTS

当前 main 已记录且 npm Registry exact version 已确认存在：

```text
@tomflow/proflow-agent-gateway = 0.1.19
@tomflow/proflow-agent-product = 0.1.19
@tomflow/proflow-execution-browser-extension = 0.1.63
@tomflow/proflow-platform-host = 0.1.30
@tomflow/proflow-task-orchestration = 0.1.12
```

不得重复 publish。Registry existence 只证明 package release，不证明本机 materialized/runtime adoption。

## WAVE21_FINAL_GATE

正式审计记录：

`docs/audits/phase3-real3-audit-wave-21-final-acceptance-gate-2026-09-13.md`

当前 Gate：

```text
TRACEABILITY_DESIGN = PASS
AUTOMATED_PROOF = PASS
REAL3_HUMAN_JOURNEY = PASS
PACKAGE_RELEASE = PASS
CURRENT_RUNTIME_ADOPTION = PENDING
WAVE21 = BLOCKED_ON_FINAL_RUNTIME_ADOPTION
PHASE3_FINAL_GO = NO
```

Wave14 的 capture-time runtime baseline 曾为 READY，但版本早于本次最终 release；旧 READY 不能覆盖当前 adoption 证据。Final Gate 必须通过正式 install/setup/start/status、package-owned verify、Chrome actual Manifest/materialized Extension、Role/Host/Gateway/Task owner readback证明 final versions 已采用。

只有最终 release 触及的路径需要最小 SAME_SCENE / FAST_REPLAY；禁止无理由重跑整套 Real-3 Full Fresh。

## NEXT_ACTION

```text
1. 保持 Wave21，不进入 Wave22。
2. 需要用户明确授权 install/setup/start/restart 后，执行 final runtime adoption acceptance。
3. Acceptance mutation 前按共享 Acceptance Skill 写 AUTOMATION_START；结束写同 runId AUTOMATION_RUN 并 check-open-runs。
4. 若 final runtime adoption + affected SAME_SCENE/FAST_REPLAY PASS，则关闭 Wave21，再进入 Wave22 Performance / Engineering Throughput。
5. Wave22 完成后才裁决 REAL_3 / PHASE3_FINAL_GO。
```

## MUTATION_AUTHORITY

```text
current audit source/docs mutation = ADMITTED
stage / phase commit = AUTHORIZED by user
other unrelated WIP overwrite / reset / clean / stash = FORBIDDEN
push = FORBIDDEN unless explicitly authorized
publish = ALREADY_APPLIED_FOR_FINAL_RELEASE / DO_NOT_REPEAT
install / setup / start / restart / deploy = NOT_AUTHORIZED in current turn
```

## WORKTREE_BOUNDARY

此前唯一 unrelated WIP：

`docs/audits/operation-chain-observability-2026-09-12.md` deletion。

当前用户已明确授权将该 deletion 纳入阶段提交；本次 closure commit 同步清理 CURRENT 对其“不得 stage”的旧描述。除该已授权 deletion 外，当前没有已知 unrelated dirty WIP；提交后仍以 Git status 机械确认。

## DO_NOT_REPEAT

- 不回到旧 repair worktree / S1-F02 blocker。
- 不重复 publish 已存在 exact Registry versions。
- 不新建 Task/Worker/Conversation 来重复证明已通过的 Real-3。
- 不把历史 runtime READY 冒充 final release current adoption。
- 不把 source/test PASS 冒充 Runtime/Human Gate。
- 不 reset/clean/stash unrelated WIP。
- 不跳过 Wave21 直接进入 Wave22。

## STOP_POINT

`FULL_CHAIN_AUDIT / WAVE_01_TO_20_DONE / WAVE21_BLOCKED_ON_FINAL_RUNTIME_ADOPTION / FINAL_RELEASE_PUBLISHED / REAL3_TASK_SUCCEEDED_V11 / PHASE3_FINAL_GO_NO / INSTALL_RESTART_AUTH_REQUIRED`

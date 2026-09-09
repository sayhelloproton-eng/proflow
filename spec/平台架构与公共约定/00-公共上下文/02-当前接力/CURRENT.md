# CURRENT｜Phase 3 当前接力

> 更新时间：2026-09-09。这里是下一 Chat 的唯一滚动执行入口；历史 acceptance、旧 adoption 现场与旧假设不拥有当前 authority。

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
CURRENT_EXECUTION_MODE = REAL3_GPT6_INDEPENDENT_AUDIT_REPAIR
```

## CURRENT_AUTHORITY

```text
main repo = /Users/agent/Desktop/proton-workspace/repos/proflow
main branch = main
main baseline before this handoff commit = 939a017b876c644efe3838eb223577bbb8949f35
active repair worktree = /Users/agent/Desktop/proton-workspace/worktrees/proflow-real3-audit-fixes
active repair branch = chatgpt/real3-audit-fixes-20260909
repair baseline = 939a017b876c644efe3838eb223577bbb8949f35
REAL_3 = NOT_PASS
```

## AUDIT_CONTEXT

GPT-6.0 对 `1e8faae..939a017` 做独立审计后给出 14 个 findings。当前不把审计文本直接当真相；每条必须先机械复核，再按 Engineering Decision 批量修复。

当前按 4 个 Stage 收敛：

```text
S1 = platform survival / credential / provider isolation / process lifecycle
S2 = effect / deadline / concurrency
S3 = durable reconciliation
S4 = runtime status / entrypoint consistency
```

## S1_STATUS

```text
F01 credential canonical protection = CONFIRMED / PATCHED
F02 provider child isolation = CONFIRMED / NOT_YET_PATCHED
F03 reconciliation backoff busy-loop = CONFIRMED / PATCHED
F04 managed process lifecycle = CONFIRMED / PATCHED

S1 targeted tests after F01/F03/F04 = 10/10 PASS
Full Suite = NOT_RERUN
```

F01/F03/F04 当前修改只存在于独立 repair worktree，不在 main。F02 仍是 S1 blocker：Repomix / CodeGraph 不能继续在 Extension/bridge Node control process 内执行；应使用受模块管理、provider-scoped 的独立 child，且不得引入新的通用 Provider framework / Service / Domain。

## EXECUTION_PROTOCOL

本仓库强制继承 workspace Skill：

`/Users/agent/Desktop/proton-workspace/skills/chat-local-engineering-protocol/SKILL.md`

当前版本为 `chat-local-engineering.v2`，双环境为硬约束：

```text
Chat Sandbox = analysis / audit / design / mutation staging / review
Local Machine = current truth / snapshot / batch apply / Git / real execution / verification
MCP = bounded transport, not interactive IDE
```

每个 Engineering Decision 默认：

```text
Minimum-Sufficient Local Snapshot
→ Sandbox decide/mutate/review
→ one Mutation Bundle
→ one guarded Local batch apply
→ Local targeted verification
→ failure/result evidence back to Sandbox
```

目标：`LMR≈1 / LSR≈0 / PTR<10%`。

## NEXT_ACTION

```text
1. Finish S1 F02 design in Sandbox from the already acquired snapshot; do not restart per-file MCP reading.
2. Form one complete S1 Mutation Bundle including F01-F04 and tests/review adjustments.
3. Guarded batch-apply the complete S1 bundle to the repair worktree.
4. Run only S1 targeted tests locally; Failure First on any failure.
5. If S1 PASS, continue S2 with a new Minimum-Sufficient Snapshot only for its blast radius.
6. Full Suite remains a final Stage Gate, not a debugging loop.
7. Do not claim REAL_3 PASS until Product Workspace real deployment/E2E succeeds.
```

## MUTATION_AUTHORITY

```text
main source mutation for audit fixes = FORBIDDEN; use repair worktree
unrelated WIP overwrite/stage/clean = FORBIDDEN
push = FORBIDDEN unless explicitly authorized
publish / deploy / release = NOT_ADMITTED by this handoff
non-idempotent retry after timeout/UNKNOWN = FORBIDDEN until authority recovery
```

## DO_NOT_REPEAT

- 不再用 MCP `read → think → edit → read` 驱动普通开发；MCP 是 Sandbox 与 Local 的批量传输层。
- 不因一个 targeted failure 直接重跑 Full Suite。
- 不重复读取已经被 snapshot 解决的本机源码，除非 source drift、验证失败、runtime mismatch 或 evidence-triggered scope expansion。
- 不把 workspace 当 OS sandbox；outside-workspace 仍按冻结设计为 notice，不重引入 `COMMAND_CONFINEMENT`。
- 不在 main 混入 repair worktree 的审计修复。

## STOP_POINT

`REAL3_GPT6_AUDIT_REPAIR / S1_F01_F03_F04_PATCHED_TARGETED_10_OF_10_PASS / S1_F02_PROVIDER_CHILD_ISOLATION_PENDING / FULL_SUITE_NOT_RERUN / MAIN_PROTOCOL_V2_INHERITANCE_SYNCED / REAL_3_NOT_PASS / PUSH_FORBIDDEN`。

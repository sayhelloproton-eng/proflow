# CURRENT｜Phase 3 当前接力

> 更新时间：2026-09-11。这里是下一 Chat 的唯一滚动 **ProFlow 项目事实**入口；历史 acceptance、旧 adoption 现场、旧自动化 SOP 与旧假设不拥有当前 authority。本次只完成共享执行协议去重，不重新裁决 Real-3 产品阶段。

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
main baseline before this handoff = 939a017b876c644efe3838eb223577bbb8949f35
active repair worktree = /Users/agent/Desktop/proton-workspace/worktrees/proflow-real3-audit-fixes
active repair branch = chatgpt/real3-audit-fixes-20260909
repair baseline = 939a017b876c644efe3838eb223577bbb8949f35
REAL_3 = NOT_PASS
```

精确当前 Git HEAD/status 必须在执行时从机械 authority 读取；这里的 baseline 只说明当前接力来源，不替代磁盘真相。

## SHARED_PROTOCOLS

```text
LOCAL_ENGINEERING
= /Users/agent/Desktop/proton-workspace/skills/chat-local-engineering-protocol/SKILL.md

ACCEPTANCE_AUTOMATION
= /Users/agent/Desktop/proton-workspace/skills/chat-local-acceptance-automation-protocol/SKILL.md
```

CURRENT 只定义 ProFlow 的产品事实、checkpoint、blocker、项目级权限和下一项目动作。Engineering Decision / source acquisition / mutation / verify / tool routing，以及 Browser/CLI/PTTY/MCP/runtime/auth/recovery/testing/telemetry 等通用 mechanics 不再复制到 CURRENT。

## AUDIT_CONTEXT

GPT-6.0 对 `1e8faae..939a017` 做独立审计后给出 14 个 findings。当前不把审计文本直接当真相；每条必须先机械复核，再按当前 Frozen Spec 与 owning boundary 处理。

当前按 4 个产品修复 Stage 收敛：

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

## NEXT_ACTION

```text
1. 关闭 S1 F02 provider child isolation，保持 Frozen Spec 与当前 repair worktree 边界。
2. 将已确认的 F01-F04 收敛为完整 S1 修复候选，不改变未授权产品语义。
3. 证明 S1 受影响行为满足正式 Test Plan；S1 关闭后再进入 S2。
4. Full Suite 仍是阶段最终 Gate，不因局部 blocker 被冒充为已完成。
5. 只有真实 Product Workspace 的正式 Deployment/E2E 满足当前 Test Plan，才允许 REAL_3 进入 PASS 裁决。
```

具体如何读取源码、形成 mutation、运行 targeted verification、从失败恢复，全部按 Engineering Skill；如何自动化真实用户 Journey、Browser/CLI/MCP/recovery，全部按 Acceptance Skill。

## MUTATION_AUTHORITY

```text
main source mutation for current audit fixes = FORBIDDEN; use repair worktree
unrelated WIP overwrite/stage/clean = FORBIDDEN
push = FORBIDDEN unless explicitly authorized
publish / deploy / release = NOT_ADMITTED by this handoff
```

这些是当前 ProFlow 项目级权限，不是共享执行方法。

## DO_NOT_REPEAT

- 不把 workspace 当 OS sandbox；outside-workspace 仍按冻结设计为 notice，不重引入 `COMMAND_CONFINEMENT`。
- 不在 main 混入当前 repair worktree 的审计修复。
- 不把源码/测试 PASS 冒充 Real-3 真实 Product Workspace Journey PASS。
- 不因为项目旧 Automation Runbook 更详细，就用它覆盖当前 Engineering/Acceptance Skill。

## STOP_POINT

`REAL3_GPT6_AUDIT_REPAIR / S1_F01_F03_F04_PATCHED_TARGETED_10_OF_10_PASS / S1_F02_PROVIDER_CHILD_ISOLATION_PENDING / FULL_SUITE_NOT_RERUN / SHARED_PROTOCOLS_SYNCED / REAL_3_NOT_PASS / PUSH_FORBIDDEN`。

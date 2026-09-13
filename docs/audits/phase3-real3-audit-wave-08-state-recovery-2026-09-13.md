# Phase 3 / Real-3 Audit｜Wave 08｜状态机与恢复语义

日期：2026-09-13
状态：DONE（以本 Wave frozen-decision targeted verify receipt 为准）

## Scope

审计 `start / complete / wait / fail / pause / resume / reopen` 的 Task/Node owner semantics，以及 `runNo / expectedVersion / TaskRoleBinding / node_execution_history / UNKNOWN / restart` 的恢复边界。

## Mechanically Confirmed

- `resumeTask` 只允许 WAITING/PAUSED；FAILED 必须显式 reopen；WAITING 有 unresolved Message 时拒绝 resume。
- `startNode` 只允许 Task-bound Worker；run-level workerRef 来自稳定 TaskRoleBinding。
- `completeNode` / `failNode` 都由 current bound Worker 写 owner truth；WAITING 只来自显式 workflow blocker。
- Execution `runNo` 已进入 durable idempotency fingerprint；UNKNOWN 使用 reality reconciliation，不 blind replay。
- Backend Reconciliation 对 RECOVERY_RESUME 做 runNo + worker generation fence，signal 只有 wake applied 后才 ack；UNKNOWN_REALITY 不转成 Task workflow mutation。

## Finding W08-F01｜PRODUCT DEFECT｜reopen 后续已开始 Node 复用旧 runNo

### First divergence

`reopenNode` 对目标 Node 正确执行 `runNo + 1`，但对所有后续 Node 只做 `PENDING + workerRef=null`，没有区分“从未开始的未来 Node”和“已经开始、现在被回退失效的 run”。

与此同时：

- `preserveRunHistory()` 已把后续已开始 run 归档；
- SQLite `node_execution_history` 以 `(node_id, run_no)` 唯一；
- `completeNode` 对未来 rerun 会按当前 `runNo` 插入 history。

因此三节点场景中，Node2 run1 已完成后回退 Node1，旧实现会把 Node2 重置为 PENDING 但仍保留 runNo=1；Node2 再次执行完成时必然尝试第二次写 `(Node2, 1)`，违反 durable generation identity，并可触发 UNIQUE 冲突。

### Fix

`reopenNode` 对后续 Node 使用以下规则：

1. 后续 Node 已经开始过当前 run（`startedAt != null || workerRef != null`）：先保持既有 history preservation，再 `runNo + 1` 后重置 PENDING；
2. 后续 Node 从未开始：只重置为 PENDING，不虚增 runNo；
3. 所有后续 Node 都清 run-level worker/result/error/time；稳定 TaskRoleBinding 不变。

该规则没有新增状态、Owner 或 scheduler，只修复已有 `runNo = actual execution generation` 不变量。

## Executable Regression

在 `packages/task-orchestration/tests/task-owned-integration.test.ts` 新增真实 SQLite 三节点回归：

- Node1 run1 complete；
- Node2 run1 complete；
- Node3 run1 start；
- reopen Node1；
- 断言三个已开始 run 均进入 history，三个 invalidated generation 都进入 runNo2；
- Node1 run2 complete → Node2 READY run2；
- Node2 run2 complete 必须成功，并产生 Node2 history `[1, 2]`；
- Node3 READY 保持 runNo2。

该用例直接覆盖旧实现会出现的 generation reuse / history unique collision，不以源码 grep 代替行为证明。

## Spec Alignment

同步收敛：

- Domain Model：明确已开始的后续 invalidated run 也必须 advance generation；未开始 Node 不虚增；
- TDD CP/RF：将 downstream generation identity 纳入 CP-TASK-ORCH-05 / RF-TASK-ORCH-05；
- Actual Result：只在本 Wave executable regression PASS 后记录该真实结果。

## Verification

- `node --test packages/task-orchestration/tests/task-owned-integration.test.ts`
- `pnpm --filter @tomflow/proflow-task-orchestration typecheck`
- `git diff --check`

## Residual

本 Wave 未发现第二个 owner-state blocker。Real Chrome / Carrier SAME_SCENE 不属于本 Wave，继续进入 Wave 09｜Real-3 专项。

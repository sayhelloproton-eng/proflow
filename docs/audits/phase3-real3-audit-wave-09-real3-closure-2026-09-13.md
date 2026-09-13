# Phase 3 / Real-3 Audit｜Wave 09｜Real-3 专项收口

日期：2026-09-13
状态：DONE（以本 Wave targeted regression + frozen-decision receipt 为准）

## Scope

从 Real-3 早期 blocker 到固定 Task `SUCCEEDED v11` 做 current-state remap：binding 三态、Deny suppression、Attention 双向桥/restart occurrence、Dev→Test WAKE、REOPEN→原 Test Worker、Permission classification/recovery、owner failure recovery、三 Direct Tool 独立 Test、最终 `completeNode`。

## Evidence

当前 Owner calibration：

- Task `task-real3-final-autowake-20260912 = SUCCEEDED v11 / currentNodeId=null`；
- Dev `real3-dev-20260912 = SUCCEEDED run 1`；
- Test `real3-test-20260912 = SUCCEEDED run 2`；
- Test REOPEN 复用原 workerRef `6aa2b749-87f4-83e8-bc7f-929161400e39`；
- Test run 2 独立取得 Repomix / CodeGraph / Local Dev 成功事实并正式 `completeNode`。

本 Wave targeted executable regression：**81/81 PASS**，覆盖：

- Permission binding DEFER→AUTO_ALLOW / timeout/conflict fail-closed；
- Deny restart guard、全部 WAKE final physical guard、future occurrence recovery；
- Attention occurrence identity、restart rebuild、authenticated `/tasks` relay；
- unconfirmed auto-attempt no-replay；
- backend Task Reconciliation generation fence / bounded catch-up / durable signal ack / UNKNOWN no replay / capacity / keyset；
- Agent Runtime Role adoption/worker validation/collaboration/terminal safety；
- Dev/Test Worker Turn + same-worker REOPEN；
- Gateway auth/normalization/budget/File Bridge/relay/readiness；
- Direct Tool provider child isolation / Repomix / CodeGraph behavior。

## Findings

### W09-F01｜STALE CONTROL PLANE｜CURRENT 仍停在 2026-09-11 repair worktree / S1-F02 pending

该内容与当前 main source、Real-3 terminal Owner facts、当前 full-chain audit 完全冲突。继续保留会让下一 Chat 回到已经消费的 repair branch/blocker。

**整改**：重写 CURRENT，只保留 2026-09-13 当前 Task terminal facts、Wave 01..09 状态、next Wave 10、当前 mutation/no-commit/no-publish 边界。

### W09-F02｜STALE BACKLOG｜多个 Module TODO 将已实现旧任务继续标 READY/PLANNED

Task Orchestration、Agent Runtime/Product/Dev/Test/Gateway、Platform Host 的 TODO 仍保留 2026-08 implementation skeleton；这些能力已经存在于 current source/tests，且其中大量已经被 Real-3 正式 Journey 消费。

**整改**：从 current backlog 移除历史任务；保留 historical ID 作为 provenance，不把 external compatibility / release / Final Gate 伪装成 implementation TODO。

### W09-F03｜VALID｜Real-3 当前 Journey 文档主语义仍正确

J0→J4、Owner facts + real path 双证据、same Worker/Conversation、WAKE delivered != Node success、Direct Tool 不进入 Execution lifecycle 等主语义与当前实现一致。新增 2026-09-13 terminal calibration，避免旧 2026-09-09 “进入源码实现”段被误读为当前 checkpoint。

## Verification

- pre-remediation targeted Real-3 regression：81/81 PASS；
- post-remediation docs/current-backlog consistency grep；
- `git diff --check`。

## Residual

Permission/Carrier 的具体 `x-openai-isConsequential=false`、schema/materialization、parser/policy/action/watchdog/log chain 在 Wave 10 专项审计；本 Wave 不提前吞并。Phase 3 Final GO 仍留到 Wave 21。

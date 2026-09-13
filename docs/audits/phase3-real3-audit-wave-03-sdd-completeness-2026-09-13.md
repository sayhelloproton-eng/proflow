# Phase 3 / Real-3 Audit｜Wave 03｜SDD 完整性

日期：2026-09-13
状态：DONE

## Scope

审 Task/Node lifecycle、Task Observer、Worker Turn、Browser Carrier Permission/Attention、Execution Approval/UNKNOWN、restart/recovery 与 execution-browser-extension 当前 Module responsibilities。目标是消除同一 SDD 层内部仍存在的“双语义”和已被源码/Real-3 推翻的 current backlog。

## Evidence

- Task Public API / lifecycle / transaction / Task Observer SDD：PENDING→READY、WAITING、FAILED、resume/reopen、durable event/catch-up、UNKNOWN owner separation。
- Agent Public API / Worker Turn / Tool Action contract。
- Execution Policy / UNKNOWN recovery / System Observer SDD。
- `execution-browser-extension/TECHNICAL-DESIGN.md` 当前 Real-3 topology。
- 当前 OpenAPI：三个 shipped Role 的所有 operation 显式 `x-openai-isConsequential:false`。
- 当前 Permission source：`carrier-permission-lifecycle.ts` 只在 AUTO_ALLOW 时选择页面实际存在的 `allowAlways`，否则 `allow`；`allowOnce` 属人工。
- 当前 System Observer source：Extension `observer-recovery-controller` 组合，Host 提供 bounded owner views/reason。
- Real-3 owner facts：FAILED v8 → REOPENED v9 → STARTED v10 → COMPLETED v11；同一 TaskRoleBinding Worker 被复用。

## Findings / Changes Applied

### W03-F01｜WRONG｜Execution Policy 同时保留两套 consequential 规则

旧文档一处写 `x-openai-isConsequential:false + user Always Allow`，另一处又要求 Local Dev mutation/command 按真实副作用设 consequential。两者都与 2026-09-13 已发布 schema 冲突。

已统一：三个 shipped GPT 的每个 operation 固定 `false`；真实副作用安全由 ProFlow 自有 admission/Effect Gate/provider safety/UNKNOWN recovery 承担，不能从 OpenAI metadata 推导权限。

### W03-F02｜STALE｜Agent Public contract 重复旧的“Local Dev mutation consequential”表述

已删除 effect-based OpenAI flag 分支，保留真实 effect policy 分层；Agent dependency index 同步改为显式 all-false。

### W03-F03｜STALE｜Worker Turn 把 trusted recovery 写成“自动 Always Allow”单一路径

已改为 current Permission lifecycle：ordinary Action 不依赖 Permission；unexpected surface 才 classify，AUTO_ALLOW 只选择页面当前真实可用的 `allowAlways` 或 `allow`，`allowOnce` 仅人工，deny occurrence-scoped。

### W03-F04｜WRONG｜Extension README 仍宣称拥有 Task Observer deterministic progression

当前技术设计和源码均已把 deterministic progression/lost-trigger reconciliation 迁至 backend application。README 已改为只保留 Carrier kick/dispatch adapter；Extension 继续拥有 Browser Carrier、System Observer application、Local Tool Effect Gate 等物理 runtime 能力。

### W03-F05｜STALE/DUPLICATE｜active TODO 把已完成/已迁移的 EXE-BR-001..008 继续列为 READY/PLANNED

这会让后续 Agent 把旧架构再次施工，包括把 Task Observer搬回 Extension、重做 Always-Allow 主链等。已剔除这些历史 current-backlog 条目；当前没有已冻结且未完成的 implementation task。历史过程由 Git/provenance/audit evidence 保留。

`d7043fc` 的 Permission action-dispatch observability 是已实现但暂不发布的 release/adoption bookkeeping，不登记成新的 implementation TODO。

### W03-F06｜VALID｜Task lifecycle / recovery 设计已形成闭环

Task SDD 当前明确：
- PENDING→READY 是 deterministic readiness；
- WAITING 只表示真实 workflow/business blocker；
- raw Carrier/Execution transient/UNKNOWN 不直接映射 WAITING；
- run 得到可信失败结论可 `failNode`，retryable failure 可显式 REOPEN；
- reopen 清 run-local workerRef、保留 TaskRoleBinding、runNo+1；
- resume/reopen durable Event 可由 backend bounded catch-up 重建 typed wake intent；
- UNKNOWN 不盲目 replay。

这些与 Real-3 最终运行证据一致，本 Wave 不修改 Task 状态机。

## Verification

- Execution Policy 不再出现 `+ user Always Allow` 或“Local Dev mutation 按副作用设置 consequential”。
- Agent current contracts 必须声明 shipped operations 全部 false。
- Worker Turn 不再把 routine Permission 写成单一 Always-Allow happy path。
- Extension README 不再拥有 Task Observer deterministic progression。
- Extension TODO 不再含 `EXE-BR-001..008` active implementation blocks。
- `git diff --check` PASS。

## Residual / Carry Forward

- Wave 04：把上述 current design invariants 映射到 TDD，重点检查 Permission/characterData/background recovery/transient retry/slugged URL/REOPEN same-worker/action observability 是否有正式测试设计。
- Wave 05：清理自动化测试中仍存在的 `localDev consequential=true` 等旧断言与“源码 grep 代替行为证明”的假绿色。
- Wave 13：重新审 operation/action logs 是否完整串起 classify → dispatch → applied/released → page reality。

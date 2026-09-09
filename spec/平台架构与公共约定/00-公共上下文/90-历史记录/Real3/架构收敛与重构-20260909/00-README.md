# Real-3 架构收敛与重构｜入口

> 日期：2026-09-09
> 本目录只解决本轮架构收敛、实施、重新部署与真实验证；已废止方案不再保留，避免与当前 authority 混淆。

## 当前权威顺序

1. `01-Real3重构问题审计与冻结结论.md`：解释为什么必须重构，以及本轮已经冻结的边界。
2. `02-Real3重构执行计划书.md`：**唯一实现计划 authority**；源码修改、测试、发布按此推进。
3. `03-工作区重新部署手册.md`：candidate 形成后，在真实 Product Workspace `/Users/agent/Desktop/proton-workspace` 重新部署。
4. `04-模拟人工测试前置准备.md`：只记录真实验收前置、当前机械状态和 blocker，不重复部署 SOP。

## 冻结产品心智

GPT 侧只保留五个概念：`Task / Node / Document / Peer / Tools`。

Tools 只保留三类直接工具：`Repomix / Local Dev / CodeGraph`。GPT-facing 不再出现 `executeCapability / getExecution / readExecutionOutput`，也不要求模型携带 Task/Node/Worker/Execution 身份去调用工具。

## 冲突裁决

本目录内若有冲突：`02` > `03/04` > `01`。Active/normative SDD 与本目录冲突时，先执行 `02` 的 Step 1 对齐规范，再进入源码实现。

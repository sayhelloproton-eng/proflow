# ProFlow Phase 3 公共上下文入口

> 用途：为 Phase 3 最终真实验收提供跨 Chat / Agent 的稳定公共上下文与总纲总控入口。
> 更新时间：2026-08-26。

## 定位

本目录服务于 **Phase 3 验证总纲总控与领域验收执行者的接管**，不是新的业务规范源，也不是另一套测试计划。

当前 Phase 3 已从系统性开发/整改阶段切换到最终真实验收阶段。公共上下文的职责是让新 Chat 首先知道：当前在哪个 Real 阶段、总控要证明什么、什么情况下 STOP/GO、哪些 Frozen 决策不得重开。

## 权威关系：规范真源与当前事实必须分开

**规范/合同真源**：已冻结 `spec/`、正式架构裁决、FINAL_FROZEN Test Plan。它们回答“系统应该是什么”。

**当前事实证据**：当前仓库 Git/source、Registry 安装物、runtime reality、真实 E2E evidence。它们回答“系统现在实际是什么”。

**总控状态**：本目录 `02-当前总控状态与Real路线.md`。它回答“当前允许验收哪一阶段、上一阶段是否已过门”。

**历史解释**：本目录其它摘要、历史 Chat / 旧交接提示词。它们只解释“为什么走到这里”。

出现冲突时：

- 当前代码/真实 evidence 不满足 Frozen Spec：记为 implementation gap / blocker，不能用代码反向修改规范。
- 真实外部行为证明 Frozen 假设本身有缺口：`STOP → SPEC_GAP / CONTRACT_CONFLICT / EXTERNAL_BEHAVIOR_MISMATCH`，走正式变更，不静默改写。
- 本目录与 Frozen Spec 冲突：更新本目录，不为迁就公共摘要修改规范。

## 新 Chat 最小读取顺序

1. `02-当前总控状态与Real路线.md` —— 先知道总控职责、当前阶段与阶段门。
2. `04-测试验证与验收方法.md` —— 再确定本轮如何验收、如何分类失败、什么才算 PASS。
3. `03-冻结架构与关键决策.md` —— 防止为测试方便重开 Frozen Architecture。
4. `05-执行纪律与工具规则.md` —— 明确总控、执行者、用户三方分工与整改纪律。
5. `14-配置自动化与OpenAI-Secure-MCP-Tunnel后续.md` —— 配置自动化审计、技术问答、人工边界与当前自动化停止门。
6. 当前 Real 对应领域的正式 spec / test plan / evidence index。
7. 只有需要追溯原因时，再读 `01-总纲历史时间线.md` 与 `07-历史问题与防回归清单.md`。

## 文件职责

- `01-总纲历史时间线.md`：只解释阶段演进与关键转折。
- `02-当前总控状态与Real路线.md`：阶段状态与**验证总纲总控职责**的唯一公共入口。
- `03-冻结架构与关键决策.md`：防止新 Chat 重开已经冻结的架构。
- `04-测试验证与验收方法.md`：统一 Real-2～Real-6 的最终真实验收方法与 failure routing。
- `05-执行纪律与工具规则.md`：统一总控/执行者/用户分工、checkpoint、本机工具、gate、发布纪律。
- `06-新Chat接管模板.md`：让新 Chat 以“验收总控”身份接管，而不是默认变成开发者。
- `07-历史问题与防回归清单.md`：记录已经反复踩过、禁止再犯的问题模式。
- `08-关键真源与证据导航.md`：从公共上下文跳到正式 spec / test / evidence。
- `12-Real2-B6-同角色连续3次覆盖PASS与合同收口.md`：记录公共 `createCustomGptRole` 在不清 workspace 下连续 3 次真实创建并覆盖最新 Product Role 的 PASS evidence，以及对应合同澄清。
- `13-Real2-最终冻结与Real3交接.md`：Real-2 最终冻结事实与进入 Real-3 的边界。
- `14-配置自动化与OpenAI-Secure-MCP-Tunnel后续.md`：当前唯一的配置自动化盘点与技术问答入口；记录 Provider resolver 停止门、正式交付漂移和不可自动化的人类动作。
- `15-当前上下文与Tunnel任务流转-20260825.md`：当前完整 Chat 交接与实时执行状态摘要；其中易漂移事实必须在接管时重新核验。

## 维护原则

公共上下文只保存跨领域、跨 Chat、长期稳定的控制信息。
不要记录易过期的 package version、HEAD、临时 PID、一次性 Workspace 路径；这些由接管 Chat 机械读取。
阶段状态变化优先更新 `02`；验收方法/永久纪律变化才更新其它公共文件。
领域实现细节、一次性 blocker、具体 evidence 必须落回对应领域或 evidence，不把本目录再次膨胀成巨型总纲。

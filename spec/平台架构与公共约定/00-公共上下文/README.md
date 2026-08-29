# ProFlow Phase 3 公共上下文入口

> 用途：为 Phase 3 最终真实验收提供跨 Chat / Agent 的稳定公共上下文与总纲总控入口。
> 更新时间：2026-08-29。
> **当前最新接手入口：[`17-Real3全量整改实施发布与Fresh回放进度-20260829.md`](17-Real3全量整改实施发布与Fresh回放进度-20260829.md)。新 Chat 必须同时读取 16 第 10 节完整 P1～P18；17 只续接实施、发布与回放进度，不替代 16 的问题登记。**

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

1. `17-Real3全量整改实施发布与Fresh回放进度-20260829.md` —— **当前最新执行进度入口**；恢复实施提交、候选版本、发布与 Fresh 回放进度。
2. `16-Fresh-Workspace真实人工验收与新Chat交接-20260829.md` —— 必须读取第 10 节完整 `P1～P18` 和两个额外 P0；17 不替代原始问题登记。
3. `02-当前总控状态与Real路线.md` —— 确认 Real-1/Real-2 已 PASS、当前仍在 REAL_3，禁止退回旧阶段。
4. `05-执行纪律与工具规则.md` —— 明确 `ISSUE_DISCOVERY != FIX_AUTHORIZATION`、HARD STOP、CodeGraph-first 与冻结 residual list。
5. `14-配置自动化与OpenAI-Secure-MCP-Tunnel后续.md` —— 回读配置自动化设计背景；旧 snapshot 若与 16/17 冲突，以 16/17 + 当前机械事实为准。
6. `15-当前上下文与Tunnel任务流转-20260825.md` —— 历史长交接与此前执行证据；不再把顶部旧 snapshot 当当前现场。
7. `04-测试验证与验收方法.md` 与 `03-冻结架构与关键决策.md`。
8. 当前 Real 对应领域的正式 spec / test plan / evidence index。
9. 只有需要追溯原因时，再读 `01-总纲历史时间线.md` 与 `07-历史问题与防回归清单.md`。

## 文件职责

- `01-总纲历史时间线.md`：只解释阶段演进与关键转折。
- `02-当前总控状态与Real路线.md`：阶段状态与**验证总纲总控职责**的唯一公共入口。
- `03-冻结架构与关键决策.md`：防止新 Chat 重开已经冻结的架构。
- `04-测试验证与验收方法.md`：统一 Real-2～Real-6 的最终真实验收方法与 failure routing。
- `05-执行纪律与工具规则.md`：统一总控/执行者/用户分工、CodeGraph-first、先审完再整改、统一验证、实时汇报与发布纪律。
- `06-新Chat接管模板.md`：让新 Chat 以“验收总控”身份接管，而不是默认变成开发者。
- `07-历史问题与防回归清单.md`：记录已经反复踩过、禁止再犯的问题模式。
- `08-关键真源与证据导航.md`：从公共上下文跳到正式 spec / test / evidence。
- `12-Real2-B6-同角色连续3次覆盖PASS与合同收口.md`：记录公共 `createCustomGptRole` 在不清 workspace 下连续 3 次真实创建并覆盖最新 Product Role 的 PASS evidence，以及对应合同澄清。
- `13-Real2-最终冻结与Real3交接.md`：Real-2 最终冻结事实与进入 Real-3 的边界。
- `14-配置自动化与OpenAI-Secure-MCP-Tunnel后续.md`：配置自动化设计背景、人工边界与技术问答；2026-08-26 snapshot 已是历史，当前事实以 16 + 机械 readback 为准。
- `15-当前上下文与Tunnel任务流转-20260825.md`：历史长交接与此前执行证据，继续保留追溯价值，但不再是最新现场入口。
- `16-Fresh-Workspace真实人工验收与新Chat交接-20260829.md`：**当前最新完整交接**；保存本轮真实 Registry/Fresh Workspace/Browser/Tunnel/Model 人工验收，且第 10 节明确保留原始 `P1～P18` 问题登记表（现象、当前判断、已确认根因/证据），第 11 节再做 Severity P0/P1/P2 Root 合并；同时记录保留现场与下一 Chat / Work 接手规则。
- `17-Real3全量整改实施发布与Fresh回放进度-20260829.md`：**当前最新执行进度**；记录 D1～D5/P1～P18 实施提交、发布候选、真实 Registry 发布与 Fresh 回放证据；必须与 16 配套读取。

## 维护原则

公共上下文只保存跨领域、跨 Chat、长期有接管价值的控制信息与关键真实验收快照。易漂移的 HEAD、远端资源和 runtime 状态在交接文档中可以作为“已观察快照”记录，但接管时必须机械重读，不得直接当实时真值。
阶段状态变化优先更新 `02`；永久纪律变化更新 `05`；配置自动化设计背景更新 `14`；长历史继续保留在 `15`；当一次真实人工验收形成新的、足以改变接手路径的完整现场时，可新增明确日期的最新 handoff，并由 README 指向唯一当前入口。
领域细节仍优先落回正式领域 spec/evidence；handoff 只记录为了下一 Chat 正确接管而不可缺失的事实、root cause 与授权边界。

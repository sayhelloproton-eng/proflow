# ProFlow Phase 3 公共上下文入口

> 用途：为 Phase 3 最终真实验收提供跨 Chat / Agent 的稳定公共上下文与总纲总控入口。
> 更新时间：2026-08-30。
> **当前唯一执行交接入口：[`09-Real3当前上下文与未解决问题-20260829.md`](09-Real3当前上下文与未解决问题-20260829.md)。文件名沿用历史引用，正文当前实际执行阶段为 Deployment Closeout。**

## 权威关系

- **规范/合同真源**：已冻结 `spec/`、正式架构裁决、FINAL_FROZEN Test Plan。
- **当前事实真源**：当前 Git/source、Registry 安装物、runtime reality、真实 E2E evidence。
- **阶段总控真源**：`02-当前总控状态与Real路线.md`。
- **当前执行上下文**：`09-Real3当前上下文与未解决问题-20260829.md`。
- **历史原因**：需要时通过 Git history、`01`、`07` 追溯，不再维护多份滚动 handoff。

冲突处理：

- 代码/真实 evidence 不满足 Frozen Spec → implementation blocker。
- 外部 reality 证明 Frozen 假设有缺口 → `STOP → SPEC_GAP / CONTRACT_CONFLICT / EXTERNAL_BEHAVIOR_MISMATCH`。
- 公共上下文与 Frozen Spec 冲突 → 更新公共上下文，不反向修改规范。
## 新 Chat 最小读取顺序

1. `09-Real3当前上下文与未解决问题-20260829.md` —— 当前唯一执行交接、dirty WIP、未解决 Root、下一步顺序。
2. `02-当前总控状态与Real路线.md` —— 当前 Real 阶段与 STOP/GO。
3. `05-执行纪律与工具规则.md` —— 授权边界、CodeGraph-first、统一验证纪律。
4. `03-冻结架构与关键决策.md` + `04-测试验证与验收方法.md`。
5. 当前问题所属领域的正式 spec / Test Plan / evidence。
6. 只有需要追溯原因时才读 `01` / `07` 或 Git history。

## 文件职责

- `01-总纲历史时间线.md`：阶段演进与关键转折，只用于追溯。
- `02-当前总控状态与Real路线.md`：阶段状态与验证总纲总控职责。
- `03-冻结架构与关键决策.md`：Frozen Architecture / Owner / Contract。
- `04-测试验证与验收方法.md`：真实验收与 failure routing。
- `05-执行纪律与工具规则.md`：执行授权、工具、整改与验证纪律。
- `06-新Chat接管模板.md`：通用验收总控接管模板。
- `07-历史问题与防回归清单.md`：历史反复踩坑模式。
- `08-关键真源与证据导航.md`：正式 spec / test / evidence 导航。
- `09-Real3当前上下文与未解决问题-20260829.md`：**当前唯一滚动执行上下文。**

## 维护原则

当前 Deployment Closeout 默认直接维护 `09`，不再因为每次换 Chat 机械增加 `10 / 11 / 12...` 滚动交接文件：只保留当前有效事实、未解决问题、真实 WIP、长期执行规则和下一步；已闭环过程从 `09` 删除，历史由 Git 保留。只有发生明确阶段切换或用户要求独立交接时才建立新的阶段入口。

阶段状态变化更新 `02`；永久纪律变化更新 `05`；领域合同变化回正式 spec，不把 `09` 变成第二套规范。

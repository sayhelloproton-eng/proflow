# ProFlow Phase 3 公共上下文入口

> 用途：为 Phase 3 最终真实验收提供跨 Chat / Agent 的稳定公共上下文与总纲总控入口。
> 更新时间：2026-08-30 23:40。
> **当前唯一执行交接入口：[`09-Real3当前上下文与未解决问题-20260829.md`](09-Real3当前上下文与未解决问题-20260829.md)。文件名沿用历史引用，正文当前实际执行阶段为 Deployment Closeout。**

## 权威关系

- **规范/合同真源**：已冻结 `spec/`、正式架构裁决、FINAL_FROZEN Test Plan。
- **当前事实真源**：当前 Git/source、Registry 安装物、runtime reality、真实 E2E evidence。
- **阶段总控真源**：`02-当前总控状态与Real路线.md`。
- **当前执行上下文**：`09-Real3当前上下文与未解决问题-20260829.md`；下一 Chat 优先读取其 `## 0. 2026-08-30 本 Chat 最新收口`。
- **当前循环测试总控**：`10-Deployment-Closeout循环测试进度计划书.md`，负责当前 Round / Gate / residual / Next Action，执行时优先看它的实时状态。
- **历史原因**：需要时通过 Git history、`01`、`07` 追溯，不再维护多份滚动 handoff。

冲突处理：

- 代码/真实 evidence 不满足 Frozen Spec → implementation blocker。
- 外部 reality 证明 Frozen 假设有缺口 → `STOP → SPEC_GAP / CONTRACT_CONFLICT / EXTERNAL_BEHAVIOR_MISMATCH`。
- 公共上下文与 Frozen Spec 冲突 → 更新公共上下文，不反向修改规范。
## 新 Chat 最小读取顺序

1. `09-Real3当前上下文与未解决问题-20260829.md` —— 当前执行背景、dirty WIP、未解决 Root 与授权边界。
2. `10-Deployment-Closeout循环测试进度计划书.md` —— 当前 Round / Gate / residual / Next Action；恢复执行时以这里的实时进度为入口。
3. `02-当前总控状态与Real路线.md` —— 当前 Real 阶段与 STOP/GO。
4. `05-执行纪律与工具规则.md` —— 授权边界、CodeGraph-first、统一验证纪律。
5. `03-冻结架构与关键决策.md` + `04-测试验证与验收方法.md`。
6. 当前问题所属领域的正式 spec / Test Plan / evidence。
7. 只有需要追溯原因时才读 `01` / `07` 或 Git history。

## 文件职责

- `01-总纲历史时间线.md`：阶段演进与关键转折，只用于追溯。
- `02-当前总控状态与Real路线.md`：阶段状态与验证总纲总控职责。
- `03-冻结架构与关键决策.md`：Frozen Architecture / Owner / Contract。
- `04-测试验证与验收方法.md`：真实验收与 failure routing。
- `05-执行纪律与工具规则.md`：执行授权、工具、整改与验证纪律。
- `06-新Chat接管模板.md`：通用验收总控接管模板。
- `07-历史问题与防回归清单.md`：历史反复踩坑模式。
- `08-关键真源与证据导航.md`：正式 spec / test / evidence 导航。
- `09-Real3当前上下文与未解决问题-20260829.md`：当前滚动执行背景、Root、授权与交接上下文。
- `10-Deployment-Closeout循环测试进度计划书.md`：**当前循环测试进度总控**；只维护当前 Round / Gate / residual / Next Action 与最终 PASS 条件。

## 维护原则

当前 Deployment Closeout 的背景/授权/Root 继续滚动维护 `09`，不再因为每次换 Chat 机械增加新的交接快照。用户明确要求建立的 `10` 是例外：它不是新的交接链，而是固定的一份循环测试进度总控，只滚动维护当前 Round / Gate / residual / Next Action；不得继续创建 `11 / 12...` 作为每轮进度副本。

阶段状态变化更新 `02`；永久纪律变化更新 `05`；循环测试实时进度更新 `10`；领域合同变化回正式 spec，不把 `09/10` 变成第二套规范。

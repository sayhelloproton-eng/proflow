# ProFlow Phase 3 公共上下文入口

> 用途：为 Phase 3 最终真实验收提供跨 Chat / Agent 的稳定公共上下文与总纲总控入口。
> 更新时间：2026-08-31。
> **2026-08-31 已将一次性交接 `11/12` 的有效内容吸收到长期公共上下文；当前不再依赖滚动 handoff 文件。**

## 权威关系

- **规范/合同真源**：已冻结 `spec/`、正式架构裁决、FINAL_FROZEN Test Plan。
- **当前事实真源**：当前 Git/source、npm Registry、Product Workspace、runtime reality、真实 E2E evidence。
- **阶段总控真源**：`02-当前总控状态与Real路线.md`。
- **当前执行上下文**：`09-Real3当前上下文与未解决问题-20260829.md`；文件名为历史兼容，顶部 Section 0 保存当前最新事实。
- **当前循环测试总控**：`10-Deployment-Closeout循环测试进度计划书.md`。
- **长期执行纪律**：`05-执行纪律与工具规则.md`。
- **历史原因**：需要时通过 Git history、`01`、`07` 追溯，不维护多份滚动 handoff。

冲突处理：

- 当前磁盘 / Registry / runtime 机械事实晚于公共上下文时，以机械事实为准并更新上下文。
- 代码/真实 evidence 不满足 Frozen Spec → implementation blocker。
- 外部 reality 证明 Frozen 假设有缺口 → `STOP → SPEC_GAP / CONTRACT_CONFLICT / EXTERNAL_BEHAVIOR_MISMATCH`。
- 公共上下文与 Frozen Spec 冲突 → 更新公共上下文，不反向修改规范。

## 新 Chat 最小读取顺序

1. `README.md`。
2. `09-Real3当前上下文与未解决问题-20260829.md` —— 先完整读顶部最新收口。
3. `10-Deployment-Closeout循环测试进度计划书.md` —— 当前 Gate / Next Action。
4. `02-当前总控状态与Real路线.md` + `05-执行纪律与工具规则.md`。
5. `03-冻结架构与关键决策.md` + `04-测试验证与验收方法.md`。
6. 当前问题所属领域正式 spec / Test Plan / evidence。
7. 只有需要追溯原因时才读 `01` / `07` 或 Git history。

## 文件职责

- `01-总纲历史时间线.md`：阶段演进与关键转折，只用于追溯。
- `02-当前总控状态与Real路线.md`：阶段状态与验证总纲总控职责。
- `03-冻结架构与关键决策.md`：Frozen Architecture / Owner / Contract。
- `04-测试验证与验收方法.md`：真实验收与 failure routing。
- `05-执行纪律与工具规则.md`：执行授权、工具、整改、发布与验证纪律。
- `06-新Chat接管模板.md`：通用验收总控接管模板。
- `07-历史问题与防回归清单.md`：历史反复踩坑模式。
- `08-关键真源与证据导航.md`：正式 spec / test / evidence 导航。
- `09-Real3当前上下文与未解决问题-20260829.md`：当前最新机械事实、Deployment 历史 Root、授权与接管上下文。
- `10-Deployment-Closeout循环测试进度计划书.md`：当前 Deployment/优化发布收口 Gate、证据和唯一 Next Action。

## 维护原则

不再为每次换 Chat 新建编号 handoff。`11/12` 已在 2026-08-31 完成一次性交接使命并被长期文件吸收，历史仍由 Git 保留。

阶段状态变化更新 `02`；永久纪律变化更新 `05`；当前机械事实与授权更新 `09`；循环测试实时进度更新 `10`；领域合同变化回正式 spec。公共上下文不得演化成第二套规范或无穷滚动日志。

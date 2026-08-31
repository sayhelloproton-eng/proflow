# ProFlow Phase 3 公共上下文入口

> 用途：为 Phase 3 最终真实验收提供跨 Chat / Agent 的稳定公共上下文与总纲总控入口。
> 更新时间：2026-08-31。
> **当前 Deployment 最终 latest 续接入口：[`11-Deployment最终Latest验证当前Chat交接-20260831.md`](11-Deployment最终Latest验证当前Chat交接-20260831.md)；下一 Chat 直接执行提示词见 [`12-下一个Chat提示词-Deployment最终Latest与优化收口-20260831.md`](12-下一个Chat提示词-Deployment最终Latest与优化收口-20260831.md)。**

## 权威关系

- **规范/合同真源**：已冻结 `spec/`、正式架构裁决、FINAL_FROZEN Test Plan。
- **当前事实真源**：当前 Git/source、Registry 安装物、runtime reality、真实 E2E evidence。
- **阶段总控真源**：`02-当前总控状态与Real路线.md`。
- **当前执行上下文**：`11-Deployment最终Latest验证当前Chat交接-20260831.md`；它是用户明确要求生成的一次性最新交接快照，机械事实晚于 `09/10` 时以 `11` 为准。
- **下一 Chat 执行提示词**：`12-下一个Chat提示词-Deployment最终Latest与优化收口-20260831.md`。
- **当前循环测试总控**：`10-Deployment-Closeout循环测试进度计划书.md`；其历史 Round/版本若与 `11` 的 2026-08-31 机械快照冲突，以当前 Git/Registry/runtime 与 `11` 为准。
- **历史原因**：需要时通过 Git history、`01`、`07` 追溯，不再维护多份滚动 handoff。

冲突处理：

- 代码/真实 evidence 不满足 Frozen Spec → implementation blocker。
- 外部 reality 证明 Frozen 假设有缺口 → `STOP → SPEC_GAP / CONTRACT_CONFLICT / EXTERNAL_BEHAVIOR_MISMATCH`。
- 公共上下文与 Frozen Spec 冲突 → 更新公共上下文，不反向修改规范。
## 新 Chat 最小读取顺序

1. `11-Deployment最终Latest验证当前Chat交接-20260831.md` —— 当前 Git/Registry/Product 最新机械快照、Browser 0.1.21、优化清单与精确续接点。
2. `12-下一个Chat提示词-Deployment最终Latest与优化收口-20260831.md` —— 下一 Chat 直接执行。
3. `10-Deployment-Closeout循环测试进度计划书.md` + `09-Real3当前上下文与未解决问题-20260829.md` —— 历史 Round、Root、授权背景。
4. `02-当前总控状态与Real路线.md` + `05-执行纪律与工具规则.md` —— STOP/GO、工具与授权边界。
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
- `10-Deployment-Closeout循环测试进度计划书.md`：Deployment Closeout 循环测试总控与历史 Round。
- `11-Deployment最终Latest验证当前Chat交接-20260831.md`：用户本次明确要求生成的一次性最新事实交接。
- `12-下一个Chat提示词-Deployment最终Latest与优化收口-20260831.md`：下一 Chat 直接执行提示词。

## 维护原则

默认仍不因每次换 Chat 机械新增交接快照；`09/10` 保留历史背景与循环总控。**2026-08-31 用户明确要求“梳理当前 Chat、上下文落库并生成下一个 Chat 提示词”，因此 `11/12` 是一次性显式授权例外。** 后续不得把这个例外解释成每轮自动新增编号文档。

阶段状态变化更新 `02`；永久纪律变化更新 `05`；循环测试实时进度更新 `10`；领域合同变化回正式 spec，不把 `09/10` 变成第二套规范。

# ProFlow Phase 3 公共上下文入口

> 用途：为 Phase 3 最终真实验收提供跨 Chat / Agent 的稳定公共上下文与总纲总控入口。
> 更新时间：2026-09-01。
> **2026-08-31 的一次性交接 `11/12` 已被长期公共上下文吸收；但 2026-09-01 最终 Fresh 人工验证发现不可逆 Custom GPT 创建后的恢复安全 blocker，用户明确要求生成一次性紧急 handoff：`12-Deployment最终人工验证阻断与新Chat交接-20260901.md`。在该 blocker 收口前，新 Chat 必须优先读取 `12`。**

## 权威关系

- **规范/合同真源**：已冻结 `spec/`、正式架构裁决、FINAL_FROZEN Test Plan。
- **当前事实真源**：当前 Git/source、npm Registry、Product Workspace、runtime reality、真实 E2E evidence。
- **阶段总控真源**：`02-当前总控状态与Real路线.md`。
- **当前执行上下文**：`09-Real3当前上下文与未解决问题-20260829.md`；文件名为历史兼容，顶部 Section 0 保存当前最新事实。
- **当前循环测试总控**：`10-Deployment-Closeout循环测试进度计划书.md`。
- **长期执行纪律**：`05-执行纪律与工具规则.md`。
- **跨项目自动化提效方法论**：`11-跨项目自动化模拟人工测试提效方法论.md`，新项目优先复制/继承其 FAST REPLAY、FULL FRESH、SAME SCENE、UNKNOWN recovery、timing 与 stable-flow freeze 规则。
- **历史原因**：需要时通过 Git history、`01`、`07` 追溯，不维护多份滚动 handoff。

冲突处理：

- 当前磁盘 / Registry / runtime 机械事实晚于公共上下文时，以机械事实为准并更新上下文。
- 代码/真实 evidence 不满足 Frozen Spec → implementation blocker。
- 外部 reality 证明 Frozen 假设有缺口 → `STOP → SPEC_GAP / CONTRACT_CONFLICT / EXTERNAL_BEHAVIOR_MISMATCH`。
- 公共上下文与 Frozen Spec 冲突 → 更新公共上下文，不反向修改规范。

## 新 Chat 最小读取顺序

1. `README.md`。
2. **当前 blocker 未收口前优先完整读 `12-Deployment最终人工验证阻断与新Chat交接-20260901.md`。**
3. `09-Real3当前上下文与未解决问题-20260829.md` —— 先完整读顶部最新收口。
4. `10-Deployment-Closeout循环测试进度计划书.md` —— 当前 Gate / Next Action。
5. `02-当前总控状态与Real路线.md` + `05-执行纪律与工具规则.md`。
6. 涉及自动化模拟人工、循环测试提速、Fresh/replay 时，再读 `11-跨项目自动化模拟人工测试提效方法论.md`。
7. `03-冻结架构与关键决策.md` + `04-测试验证与验收方法.md`。
8. 当前问题所属领域正式 spec / Test Plan / evidence；只有需要追溯原因时才读 `01` / `07` 或 Git history。

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
- `11-跨项目自动化模拟人工测试提效方法论.md`：从 ProFlow 实战抽象出的跨项目 FAST REPLAY / FULL FRESH / SAME SCENE / timing / UI freeze 方法，未来新项目可直接复制继承。
- `12-Deployment最终人工验证阻断与新Chat交接-20260901.md`：本次最终 Fresh 人工验证发现不可逆 Custom GPT 创建恢复安全 P1 后，由用户明确要求生成的一次性紧急交接；P1 收口并完成最终 Fresh 后应停止作为首读入口。

## 维护原则

默认不再为每次换 Chat 新建编号 handoff。`12-Deployment最终人工验证阻断与新Chat交接-20260901.md` 是用户在最终 Fresh 阻断现场明确要求的**一次性例外**；P1 收口后恢复长期公共上下文模式，不继续滚动新增 handoff。

阶段状态变化更新 `02`；永久纪律变化更新 `05`；当前机械事实与授权更新 `09`；循环测试实时进度更新 `10`；跨项目自动化提效经验更新 `11`；领域合同变化回正式 spec。公共上下文不得演化成第二套规范或无穷滚动日志。

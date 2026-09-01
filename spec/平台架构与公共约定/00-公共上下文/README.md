# ProFlow Phase 3 公共上下文入口

> 用途：为 Phase 3 最终真实验收提供跨 Chat / Agent 的稳定公共上下文与总纲总控入口。
> 更新时间：2026-09-01。
> **2026-09-01 Final Freeze：Deployment 已由用户最终裁决 PASS 并封版。真实 npm latest + 真正 Fresh Product Workspace 已完成 23/23 install；Browser Extension、Dev Tunnel、Model FAST/THINK、3 个 Role/GPT 均最终 READY；公开 `platform start → status → repeat setup → repeat status → stop → cold start → final status` 全部 PASS，最终 `PLATFORM_READY=YES`。当前版本真值：`platform-cli@0.1.50`、`dev-tunnel@0.1.25`、`execution-browser-extension@0.1.25`、`agent-runtime@0.1.13`、三个 Agent Role package `0.1.16`。Deployment 不再因历史 handoff、旧 blocker 或已裁决偶发现象重开；当前 Gate 正式进入 `REAL_3_J0_J4`。**



**Deployment 禁止 tarball 硬规则（用户再次明确，2026-09-01）：** 从现在起，Deployment Closeout 的调试、SAME SCENE、模拟人工验收、Product Workspace 验收、FULL FRESH 最终证明，**一律禁止使用 local tarball / `npm pack` 产物 / 本地 `.tgz` / `npm link` / workspace symlink / repo source override 代替真实 npm Registry 包**。即使只是“为了更快先验证一下”，也不允许把 tarball 引入当前 Deployment 主线。修复必须先完成 targeted test + typecheck，再真实发布到 npm Registry，随后只用 Registry exact/latest 安装物重放。若未来某个执行者认为 tarball 更快，必须忽略该想法并继续真实 npm 路径；除非用户以后明确撤销本规则。

## 权威关系

- **规范/合同真源**：已冻结 `spec/`、正式架构裁决、FINAL_FROZEN Test Plan。
- **当前事实真源**：当前 Git/source、npm Registry、Product Workspace、runtime reality、真实 E2E evidence。
- **阶段总控真源**：`02-当前总控状态与Real路线.md`。
- **当前执行上下文**：`09-Real3当前上下文与未解决问题-20260829.md`；文件名为历史兼容，顶部 Final Freeze 区保存当前最新事实。
- **Deployment 封版记录**：`10-Deployment-Closeout循环测试进度计划书.md`；Deployment 已结束，不再作为当前 Gate。
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
2. `02-当前总控状态与Real路线.md` —— 当前 Gate / 下一 Real。
3. `09-Real3当前上下文与未解决问题-20260829.md` —— 只读顶部 Final Freeze 与当前 Real-3 接管信息。
4. `05-执行纪律与工具规则.md`。
5. `10-Deployment-Closeout循环测试进度计划书.md` 仅在追溯 Deployment 最终验收时读取；`12` 已降级为历史事故 handoff。
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
- `09-Real3当前上下文与未解决问题-20260829.md`：顶部保存 Deployment Final Freeze 与 Real-3 接管状态；后文 Deployment 过程只作历史。
- `10-Deployment-Closeout循环测试进度计划书.md`：Deployment Final Freeze 记录与历史 Closeout 过程，不再定义当前 Gate。
- `11-跨项目自动化模拟人工测试提效方法论.md`：从 ProFlow 实战抽象出的跨项目 FAST REPLAY / FULL FRESH / SAME SCENE / timing / UI freeze 方法，未来新项目可直接复制继承。
- `12-Deployment最终人工验证阻断与新Chat交接-20260901.md`：一次性历史事故 handoff；P1/Dev Tunnel blocker 均已闭环，禁止再作为首读或当前 blocker 真源。

## 维护原则

默认不再为每次换 Chat 新建编号 handoff。`12-Deployment最终人工验证阻断与新Chat交接-20260901.md` 是用户在最终 Fresh 阻断现场明确要求的**一次性例外**；P1 收口后恢复长期公共上下文模式，不继续滚动新增 handoff。

阶段状态变化更新 `02`；永久纪律变化更新 `05`；当前机械事实与授权更新 `09`；`10` 仅保留 Deployment 封版记录；跨项目自动化提效经验更新 `11`；领域合同变化回正式 spec。公共上下文不得演化成第二套规范或无穷滚动日志。

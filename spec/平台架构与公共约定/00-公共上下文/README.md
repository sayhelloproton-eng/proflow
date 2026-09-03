# ProFlow Phase 3｜GPT Chat 公共上下文入口

> 目的：让新的 GPT Chat 在旧 Chat 上下文耗尽后，能像连续工作一样接手，而不是重新学习项目。
> 更新时间：2026-09-03。

## 1. 公共上下文是什么

公共上下文不是第二套 Spec，也不是过程日志仓库。它由四层组成：

```text
01-长期规则      不随阶段轻易变化的铁律、总控职责、工具纪律
02-当前接力      当前做到哪里、什么没完成、下一步是什么
03-自动化知识库  可复用的包 Runbook、基础动作、可组合流程
90-历史记录      已结束阶段、旧 handoff、审计/整改/事故原始记录
```

正式架构、Owner、Contract、Test Plan 仍以正式 `spec/` 为规范真源；当前 Git / Registry / Product Workspace / Browser / runtime reality 是机械事实真源。

## 2. 新 Chat 固定最小读取顺序

1. 本 `README.md`。
2. `01-长期规则/01-总控职责与阶段门禁.md`。
3. `01-长期规则/02-公共上下文治理规则.md`。
4. `01-长期规则/05-执行纪律与工具规则.md`。
5. `02-当前接力/CURRENT.md`。
6. 严格按 CURRENT 的 `REQUIRED_CONTEXT` 加载 `03-自动化知识库` 对应 Runbook。
7. 只有需要追根因/审计原始记录时才读 `90-历史记录`。

## 3. 读取路由

遇到问题时不要重新探索，先查 `03-自动化知识库/README.md`：

- Dev Tunnel / login / publicBaseUrl → `包能力/dev-tunnel.md`
- Extension / pairing / Load unpacked / submit → `包能力/execution-browser-extension.md`
- platform install/update/start/status/stop → `包能力/platform-cli.md`
- npm publish / Registry → `基础动作/npm发布与Registry回读.md`
- 长任务 / PID / 日志 / UNKNOWN recovery → `基础动作/Round-PID-Log与恢复.md`
- Chat 本地仓库理解 / 结构分析 / 批量读取 / 批量修改 / Gate / 降低 Tool Call → `基础动作/Chat-高吞吐本地工程执行.md`
- Repomix / CodeGraph / Local Dev / Playwright 的能力边界、协作顺序、runtime 恢复 → `基础动作/Tool-Runtime-gptweb-mcp.md`
- Fresh Workspace → `基础动作/Product-Workspace-Fresh.md`
- Deployment 全流程 → `流程/Deployment-Fresh.md`
- 单包修复与更新 → `流程/Package-Update-Loop.md`
- Real-3 J0～J4 → `流程/Real3-J0-J4.md`

## 4. 维护规则

每个 Chat 同时是公共上下文的消费者和维护者：执行前读取；执行中发现可复用经验立即提炼；结束前更新 CURRENT。

CURRENT 只保留当前事实，不无限追加历史。Round 原始记录进入 `90-历史记录`；只有可复用结论进入 Runbook。

已经稳定的包能力写在 `包能力`，跨包机械动作写在 `基础动作`，业务/验收顺序写在 `流程`。流程只引用能力，不复制能力细节。

重大结构、Frozen Contract、Owner/State 变化必须先经用户裁决；公共上下文治理本身不得成为修改产品设计的理由。

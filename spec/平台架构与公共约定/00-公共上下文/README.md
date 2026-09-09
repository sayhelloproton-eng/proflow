# ProFlow Phase 3｜GPT Chat 公共上下文入口

> 跨项目的 Chat → Local Engineering 执行 mechanics 不在本目录维护；统一继承 `/Users/agent/Desktop/proton-workspace/skills/chat-local-engineering-protocol/SKILL.md`。本目录只负责项目状态、接力、项目长期规则与 Runbook。

> 目的：让新的 GPT Chat 在旧 Chat 上下文耗尽后，能像连续工作一样接手，而不是重新学习项目。
> 更新时间：2026-09-08。

## 0. 执行前先判“问题起点”

公共上下文的第一目标不是让新 Chat 读更多，而是让它**第一刀进入正确证据层**。完成固定最小读取后，任何诊断/修改动作前先判当前最大不确定性属于哪一类：

| 问题起点 | 第一证据层 / 第一工具 | 第一份必须拿到的 authority | 后续路由 |
|---|---|---|---|
| 普通 Web / ChatGPT / Tasks 页面异常 | Reality / Playwright Chrome | 当前 page screenshot + snapshot/DOM + URL | 现实指向代码后再进入 Repomix/CodeGraph/Local Dev |
| `chrome://`、扩展错误页、工具栏、系统 picker 等 privileged UI | Reality / AX + Swift helper + screenshot | 当前 AX tree + privileged screenshot | 再回普通 Web 或源码层；Playwright attach 失败不等于不可观察 |
| 仓库实现 / 修改任务 | Context / Repomix | 最小充分 scope 的稳定 `outputId` + grep/read 命中 | CodeGraph 证明结构 → Local Dev 批量写 / 统一验证 |
| caller/callee、composition、ownership、blast radius 的纯结构问题 | Structure / CodeGraph | 结构关系与相关 current-on-disk source | 需要修改时再补 Repomix 上下文/Local Dev 执行 |
| Git、test、build、PID、日志、Registry/Workspace 机械 readback | Execution / Local Dev | 当前磁盘/进程/命令的机械事实 | 只有出现新的结构/现实矛盾才升级其它 Plane |
| MCP runtime、连接、token、manager、controlled group 恢复 | Tool Runtime / `Tool-Runtime-gptweb-mcp.md` | runtime/manager/relay 当前状态 | 恢复工具后回原业务 checkpoint，不把工具故障冒充产品故障 |

**Reality-first override：**当前失败首先表现为 Browser/UI 现实异常时，在取得当前 screenshot/snapshot/AX evidence 之前，禁止先从源码猜 root cause。**Context-first repository rule：**问题已经确认属于仓库理解/修改后，默认先用 Repomix 最小充分范围建立批量上下文，而不是 Local Dev 逐文件探索。两条规则不冲突，关键是先判断问题起点。

**仓库修改短句镜像：范围大小只决定读多少，不决定执行形态。**任何仓库修改——即使只改 1 个文件——都统一执行 `批量读 → 想清楚 → 批量写 → 统一验证`；完整 Batch SOP 唯一由 `03-自动化知识库/基础动作/GPT-Chat-MCP-Mac高吞吐执行规则.md` 维护。

这里的路由不是“所有工具按顺序调用一遍”。每个工具只负责它不可替代的 authority；已经被上一层消除的不确定性不得由下一层重复读取。详细调度见 `03-自动化知识库/基础动作/GPT-Chat-MCP-Mac高吞吐执行规则.md`。

### 0.1 AI 执行时的冲突消解顺序

多份文档出现相似规则时，**不要按出现次数投票，也不要把所有规则平均化**。先判断它们回答的是否是同一个维度，再按下列层级消解：

```text
Formal Spec / Frozen Contract → 规范上应该是什么
当前机械 authority            → 现实中现在是什么
01-长期规则                   → 哪些执行边界绝不能越过
CURRENT                       → 当前 checkpoint 具体先做什么 / 用什么 evidence / 在哪里 STOP
Owner Runbook                 → 这个动作具体怎么做、怎么恢复
README / Routing Index 镜像   → 只负责提醒和导航，不创造新语义
90-历史记录                   → 只解释过去为什么，不参与当前裁决
```

更具体的 CURRENT route 可以覆盖通用工具路由，但不能覆盖长期安全/frozen 边界；Owner Runbook 的完整 SOP 可以展开镜像短句，但不能反向修改 CURRENT 的 checkpoint。**同一句护栏重复三次不会获得“三票权威”**，权威来自 owner 与层级。


## 1. 公共上下文是什么

公共上下文不是第二套 Spec，也不是过程日志仓库。它由四层组成：

```text
01-长期规则      不随阶段轻易变化的铁律、总控职责、工具纪律
02-当前接力      当前做到哪里、什么没完成、下一步是什么
03-自动化知识库  可复用的包 Runbook、基础动作、可组合流程
90-历史记录      已结束阶段、旧 handoff、审计/整改/事故原始记录
```

正式架构、Owner、Contract、Test Plan 仍以正式 `spec/` 为规范真源；当前 Git / Registry / Product Workspace / Browser / runtime reality 是机械事实真源。

### 1.1 公共上下文是运行时控制面，不是只读接管材料

固定闭环：`READ → ACT → OBSERVE → LEARN → WRITE BACK → CONTINUE`。机械 authority、checkpoint、blocker、root cause 或稳定执行知识一旦发生变化，必须按 owner **即时写回**，不能因为当前 Chat “自己还记得”而推迟到交接。Round Closeout 只负责第二道防遗漏。

若 `CURRENT` 中的版本、checkpoint、problem 或 `NEXT_ACTION` 已落后于当前机械现实，定义为 `CONTEXT_DRIFT`：先同步公共上下文，再进入下一重大动作。完整触发器与写回矩阵唯一由 `01-长期规则/02-公共上下文治理规则.md` 维护。

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
- Chat 本地仓库理解 / 结构分析 / 批量读取 / 批量修改 / Gate / 降低 Tool Call → `基础动作/GPT-Chat-MCP-Mac高吞吐执行规则.md`
- Repomix / CodeGraph / Local Dev / Playwright 的能力边界、协作顺序、runtime 恢复 → `基础动作/Tool-Runtime-gptweb-mcp.md`
- Fresh Workspace → `基础动作/Product-Workspace-Fresh.md`
- Deployment 全流程 → `流程/Deployment-Fresh.md`
- 单包修复与更新 → `流程/Package-Update-Loop.md`
- Real-3 J0～J4 → `流程/Real3-J0-J4.md`

## 4. 维护规则

**模型主动维护镜像：**上下文更新不依赖用户提醒。Event Trigger 成立时模型即时最小写回；Chat 结束/切换前自动 Closeout。吞吐/治理方法论默认 `MAINLINE FIRST`：执行中采集证据，主线 Gate 结束后再统一评估和升级规则。完整语义唯一由 `01-长期规则/02-公共上下文治理规则.md` 维护。


每个 Chat 同时是公共上下文的消费者和维护者：执行前读取；执行中发现可复用经验立即提炼；结束前更新 CURRENT。

CURRENT 只保留当前事实，不无限追加历史。Round 原始记录进入 `90-历史记录`；只有可复用结论进入 Runbook。

`02-当前接力/` 正常只保留 `CURRENT.md`；旧接手提示词、旧 Chat handoff、已消费 acceptance 不得留在当前目录，统一进入 `90-历史记录/`。

已经稳定的包能力写在 `包能力`，跨包机械动作写在 `基础动作`，业务/验收顺序写在 `流程`。流程只引用能力，不复制能力细节。

重大结构、Frozen Contract、Owner/State 变化必须先经用户裁决；公共上下文治理本身不得成为修改产品设计的理由。

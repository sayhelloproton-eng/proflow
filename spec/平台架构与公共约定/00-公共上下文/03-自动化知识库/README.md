# 自动化知识库｜Routing Index

> 原则：看到问题先路由到既有知识，再诊断；不要依赖 Chat 自己“记得”。`00-自动化模拟人工总原则.md` 只提供方法总览，不参与当前动作裁决。

## 第一层：先按“问题起点”选 authority

| 当前最大不确定性 | 第一工具 | 必读 Runbook / 纪律 |
|---|---|---|
| 普通 Web / ChatGPT / Tasks 当前页面 | Playwright Chrome | `基础动作/Browser-UI自动化.md` |
| `chrome://` / Extension errors / 系统 picker / privileged UI | AX / Swift helper + screenshot | `基础动作/Browser-UI自动化.md` |
| 仓库跨文件理解 / 修改 | Repomix | `基础动作/GPT-Chat-MCP-Mac高吞吐执行规则.md` |
| 纯结构关系 / ownership / blast radius | CodeGraph | `基础动作/GPT-Chat-MCP-Mac高吞吐执行规则.md` |
| Git / test / build / PID / Registry / Workspace readback | Local Dev | 对应基础动作；无需为机械事实额外 pack |
| MCP runtime / relay / token / manager | gptweb-mcp 当前 runtime | `基础动作/Tool-Runtime-gptweb-mcp.md` |

第一层只决定“先去哪里拿第一份不可替代 evidence”。拿到 evidence 后再进入下面的包能力 / 基础动作 / 流程路由。**Browser/UI symptom 必须 Reality-first；仓库理解/修改才是 Repomix-first。**不要把所有工具机械串行调用。


## 唯一知识 Owner 矩阵

| 知识类型 | 唯一 owner | 其它文件允许出现什么 |
|---|---|---|
| 跨项目测试方法心智模型 | `00-自动化模拟人工总原则.md` | 只做方法概览，不放可执行 SOP |
| 四 Plane / Batch / Reality Batch / FIRST_DIVERGENCE / Hotfix admission | `基础动作/GPT-Chat-MCP-Mac高吞吐执行规则.md` | README/长期规则只留短句镜像 |
| Browser/UI/AX/截图/Extension adoption | `基础动作/Browser-UI自动化.md` | 流程只写业务需要的 Browser checkpoint |
| gptweb-mcp manager/relay/token/sandbox/Playwright runtime | `基础动作/Tool-Runtime-gptweb-mcp.md` | 不复制工具调度算法 |
| PID/log/timeout/UNKNOWN 恢复 | `基础动作/Round-PID-Log与恢复.md` | 包 Runbook只写该包特有恢复条件 |
| npm/version/publish/Registry | `基础动作/npm发布与Registry回读.md` | 流程只编排何时进入 |
| 单包修复→发布→update→原场景 | `流程/Package-Update-Loop.md` | 包 Runbook只拥有包特有行为 |
| Deployment / Real-3 Journey | `流程/Deployment-Fresh.md` / `流程/Real3-J0-J4.md` | 不复制 Browser/Tunnel/发布 SOP |
| 某 Package / 外部资源稳定知识 | `包能力/<owner>.md` | 流程只引用，不复制 |

**判重规则：**同一知识若在两个 active 文件中都出现“完整步骤 + failure routing + recovery”，视为重复 owner，必须收敛；只有一句缺失就会改变执行路径的高风险护栏可以镜像，并必须指向上表 owner。

## 包 / 外部资源路由

| 现象 / 关键词 | 必读 Runbook |
|---|---|
| Dev Tunnel、GitHub login、Tunnel ID、publicBaseUrl、port、TLS | `包能力/dev-tunnel.md` |
| Extension、Load unpacked、pairing、heartbeat、submit | `包能力/execution-browser-extension.md` |
| platform install/update/start/status/stop/docs | `包能力/platform-cli.md` |
| Provider URL、FAST/THINK、inventory、模型 endpoint | `包能力/model-provider-runtime.md` |
| Custom GPT、Role、Identity、创建/恢复 | `包能力/custom-gpt-provisioning.md` |

## 通用机械动作路由

| 任务 | 必读 |
|---|---|
| 单包 test/typecheck/gate | `基础动作/Targeted-Gate.md` |
| version/publish/Registry exact | `基础动作/npm发布与Registry回读.md` |
| Fresh Product Workspace | `基础动作/Product-Workspace-Fresh.md` |
| Browser/系统 UI 自动化 | `基础动作/Browser-UI自动化.md` |
| Playwright connect 页、MCP runtime、工具连接/恢复 | `基础动作/Tool-Runtime-gptweb-mcp.md` |
| CLI prompt、PTY、Expect、交互输入不稳定 | `基础动作/CLI-PTY交互自动化.md` |
| 长任务、PID、日志、超时/UNKNOWN | `基础动作/Round-PID-Log与恢复.md` |
| Chat 仓库理解、广域/窄域路由、Repomix/CodeGraph 协作、批量读写、批量 Gate、降低 Tool Call | `基础动作/GPT-Chat-MCP-Mac高吞吐执行规则.md` |
| Repomix / CodeGraph / Local Dev / Playwright runtime、能力边界、连接/恢复 | `基础动作/Tool-Runtime-gptweb-mcp.md` |

## 流程路由

| 当前目标 | 流程 |
|---|---|
| 从零部署/最终 Fresh 验收 | `流程/Deployment-Fresh.md` |
| 某个包发现 bug → 发布 → 单包更新 → 原场景重放 | `流程/Package-Update-Loop.md` |
| Real-3 Task Journey | `流程/Real3-J0-J4.md` |

## 组合规则

流程是 orchestration，不拥有包的具体操作知识；工具路由也不属于某个业务流程。先按问题起点拿 authority，再进入 owner Runbook。例如 Real-3 中碰到 Tunnel：

```text
Real3 checkpoint
→ 包能力/dev-tunnel.md
→ 若需改包：流程/Package-Update-Loop.md
→ 修复并真实 update
→ 返回同一 Real3 checkpoint
```

Deployment、Package Update、Real-3 可以互相穿插，但**当前主目标必须始终由 CURRENT 指定**。

## 维护

每轮新经验先问：它属于包、基础动作还是流程？稳定结论提炼到 owner Runbook；Round 过程进历史。禁止在三个流程里分别复制一份 Tunnel/Browser 操作说明。

# 自动化知识库｜Routing Index

> 原则：看到问题先路由到既有知识，再诊断；不要依赖 Chat 自己“记得”。

## 第一层：先按“问题起点”选 authority

| 当前最大不确定性 | 第一工具 | 必读 Runbook / 纪律 |
|---|---|---|
| 普通 Web / ChatGPT / Tasks 当前页面 | Playwright Chrome | `基础动作/Browser-UI自动化.md` |
| `chrome://` / Extension errors / 系统 picker / privileged UI | AX / Swift helper + screenshot | `基础动作/Browser-UI自动化.md` |
| 仓库跨文件理解 / 修改 | Repomix | `基础动作/Chat-高吞吐本地工程执行.md` |
| 纯结构关系 / ownership / blast radius | CodeGraph | `基础动作/Chat-高吞吐本地工程执行.md` |
| Git / test / build / PID / Registry / Workspace readback | Local Dev | 对应基础动作；无需为机械事实额外 pack |
| MCP runtime / relay / token / manager | gptweb-mcp 当前 runtime | `基础动作/Tool-Runtime-gptweb-mcp.md` |

第一层只决定“先去哪里拿第一份不可替代 evidence”。拿到 evidence 后再进入下面的包能力 / 基础动作 / 流程路由。**Browser/UI symptom 必须 Reality-first；仓库理解/修改才是 Repomix-first。**不要把所有工具机械串行调用。

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
| Chat 仓库理解、广域/窄域路由、Repomix/CodeGraph 协作、批量读写、批量 Gate、降低 Tool Call | `基础动作/Chat-高吞吐本地工程执行.md` |
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

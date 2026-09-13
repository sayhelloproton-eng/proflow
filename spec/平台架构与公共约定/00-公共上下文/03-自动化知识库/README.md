# ProFlow 项目执行知识｜Routing Index（兼容目录名）

> `03-自动化知识库` 名称为历史兼容。当前目录只拥有 **ProFlow 项目特有的 package/resource/Journey/Flow 产品知识**，不再拥有跨项目 ChatGPT 本机自动化协议。

## 共享 mechanics 唯一真源

- Local Engineering：`/Users/agent/Desktop/proton-workspace/skills/chat-local-engineering-protocol/SKILL.md`
- Local Acceptance Automation：`/Users/agent/Desktop/proton-workspace/skills/chat-local-acceptance-automation-protocol/SKILL.md`

Browser/UI、CLI/PTTY、MCP/runtime、auth、timeout/UNKNOWN、recovery、Acceptance mode、checkpoint automation、testing harness、telemetry、tool routing 与高吞吐本机工程方法，统一由共享 Skill 拥有。

旧的通用兼容入口已从 active 项目知识中删除；历史形成过程只由 Git history / `90-历史记录` 解释。任何当前项目文档需要这些 mechanics 时，直接引用对应共享 Skill，不再经过项目内 stub。

## ProFlow Package / 外部资源路由

| 产品领域 | 项目 Runbook |
|---|---|
| Dev Tunnel 的 ProFlow 产品事实、stable identity、公开链路约束 | `包能力/dev-tunnel.md` |
| Execution Browser Extension 产品 identity、pairing、adoption、submit contract | `包能力/execution-browser-extension.md` |
| platform install/update/start/status/stop 的产品 contract | `包能力/platform-cli.md` |
| Provider URL/FAST/THINK/inventory 的产品 contract | `包能力/model-provider-runtime.md` |
| Custom GPT/Role/Worker 的产品 identity 与 provisioning contract | `包能力/custom-gpt-provisioning.md` |

这些 Runbook 可以定义 ProFlow 产品专属命令、identity、状态与 STOP 条件；其中若涉及通用 Browser/CLI/MCP/recovery 方法，直接服从当前共享 Skill。

## ProFlow 项目动作

- `基础动作/Targeted-Gate.md`：ProFlow package/gate 的项目特有入口和参数事实；如何组织本机验证由 Engineering Skill。
- `基础动作/npm发布与Registry回读.md`：ProFlow npm/version/Registry 产品/供应链事实；通用 UNKNOWN/retry mechanics 由共享 Skill。
- `基础动作/Product-Workspace-Fresh.md`：ProFlow Product Workspace 的项目特有 Fresh contract；通用恢复方法由 Acceptance Skill。

## ProFlow Flow

| 当前目标 | 项目 Flow |
|---|---|
| Deployment 产品 Journey | `流程/Deployment-Fresh.md` |
| 单包 defect → release/update/adoption → 原产品行为 | `流程/Package-Update-Loop.md` |
| Real-3 Task Journey | `流程/Real3-J0-J4.md` |

Flow 只拥有 ProFlow 业务顺序、checkpoint、identity、产品 PASS/FAIL/STOP 条件，不拥有通用自动化 mechanics。

## 维护

新经验先分类：若是 ProFlow 产品/package/Journey 知识，写项目 owner；若是跨项目本机工程或 Acceptance 自动化经验，进入对应共享 Skill 的 evidence/evolution；若只是单轮事故，进入历史 evidence。禁止重新把共享规则复制回本目录。

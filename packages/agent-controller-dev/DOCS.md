# agent-controller-dev — 研发 + 项目总控角色包

## 模块定位与作用

为 ProFlow 提供固定的 Controller/Dev（总控与研发）Custom GPT 角色定义、配置材料和本地 Role 注册入口。该角色负责理解任务、组织研发协作，并通过受控 Execution 完成真实代码操作。

## 主要能力

- 提供角色名称、描述、Instructions（指令）、对话开场白和静态 Action Schema。
- 通过 owning `Module.setup` + `custom-gpt-web-provisioning` 自动创建/更新真实 Private Custom GPT，并由 Agent Domain 注册稳定 Role。
- 校验角色包版本、Role、动态 Auth 与 Actions Carrier 的一致性。

## 提供的 API 与 Public Contract

- 不向 Module Graph 提供新的逻辑 Contract。
- 包级 CLI 提供 `setup`、`custom-gpt`、`role` 与 `verify` 等角色管理能力。

## 依赖的 Module、Contract 和外部资源

- 依赖 `custom-gpt-actions-gateway`，兼容版本 `>=1.0.0 <2.0.0`。
- 依赖 `custom-gpt-web-provisioning`，兼容版本 `>=1.0.0 <2.0.0`，由 Browser Extension 承担部署期 Custom GPT 自动配置。
- 依赖 ChatGPT Custom GPT、公开 HTTPS Gateway 和可用的 ChatGPT 登录状态。

## 运行形态与生命周期

类型为 Agent Package（智能体角色包），没有独立常驻进程；运行状态显示为“无独立进程”。

## 使用方式

`Module.setup` 已接入正式自动创建路径：Role 为 `READY` 时直接复用当前绑定；Role 为 `MISSING` 时由 Agent Runtime 预生成 candidate credential，Extension 在同一个 GPT Editor 内完成 Action Schema、API Key/Bearer、Knowledge ZIP、模型与三项 Capabilities 配置后创建 Private GPT，再由 `saveCurrentRole` 持久化最新 g-id / carrierUrl / credential 并执行 Gateway authenticated probe。`DRIFT` 不自动 Edit 旧 GPT；operator/Browser 完成当前 package material 的远端同步与验证后，运行 `proflow-agent-controller-dev role adopt <current-carrier-url> --workspace <workspace>`，由 Agent owner 保持原 roleRef/carrierUrl/credential 并采用当前 package version。

当前角色名固定为 `研发 + 项目总控`；`webSearch / imageGeneration / codeInterpreter` 全部开启；Knowledge 固定上传 `knowledge/custom-gpt-knowledge.zip` 本体。`custom-gpt setup`、`role ...` 与 `verify` 只用于 material 检查、诊断、恢复或显式本地管理，不承担正常部署的人工复制 Instructions / Schema / URL / Bearer 流程。

## 职责边界与限制

本模块不保存 Task 业务事实，不直接执行 Shell/Git，也不拥有 Browser Carrier。真实 Effect（副作用）必须交给 Execution。

## 术语

- Controller/Dev（总控与研发）：负责研发组织、实现与技术决策的固定角色。
- Role（角色）：注册到 ProFlow 的稳定 Custom GPT 身份。
- Action Schema（动作接口定义）：限制该角色可调用能力的 OpenAPI 描述。

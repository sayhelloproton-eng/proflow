# agent-product — 运营 + 产品经理角色包

## 模块定位与作用

为 ProFlow 提供固定的 Product（产品）Custom GPT 角色定义。它负责需求澄清、维护产品上下文，并通过公开 Actions 与 Task、Agent 协作能力交互。

## 主要能力

- 提供 Product 角色的名称、描述、Instructions、开场白和静态 Action Schema。
- 通过 owning `Module.setup` + `custom-gpt-web-provisioning` 自动创建/更新真实 Private Custom GPT，并由 Agent Domain 注册稳定 Role。
- 验证角色包版本、Role、动态 Auth 与 Gateway 接入状态。

## 提供的 API 与 Public Contract

- 不向 Module Graph 提供新的逻辑 Contract。
- 包级 CLI 提供 `setup`、`custom-gpt`、`role` 与 `verify`。

## 依赖的 Module、Contract 和外部资源

- 依赖 `custom-gpt-actions-gateway`，兼容版本 `>=1.0.0 <2.0.0`。
- 依赖 `custom-gpt-web-provisioning`，兼容版本 `>=1.0.0 <2.0.0`，由 Browser Extension 承担部署期 Custom GPT 自动配置。
- 依赖 ChatGPT Custom GPT 与公开可达的 Gateway。

## 运行形态与生命周期

类型为 Agent Package，没有独立进程；角色会话由 ChatGPT Carrier 承载。

## 使用方式

`Module.setup` 已接入正式自动创建路径：Role 为 `READY` 时直接复用当前绑定；Role 为 `MISSING` 时由 Agent Runtime 预生成 candidate credential，Extension 在同一个 GPT Editor 内完成 Action Schema、API Key/Bearer、Knowledge ZIP、模型与三项 Capabilities 配置后创建 Private GPT，再由 `saveCurrentRole` 持久化最新 g-id / carrierUrl / credential 并执行 Gateway authenticated probe。`DRIFT` 不自动 Edit 旧 GPT，必须 fail closed 进入显式处理。

当前角色名固定为 `运营 + 产品经理`；`webSearch / imageGeneration / codeInterpreter` 全部开启；Knowledge 固定上传 `knowledge/custom-gpt-knowledge.zip` 本体。`custom-gpt setup`、`role ...` 与 `verify` 只用于 material 检查、诊断、恢复或显式本地管理，不承担正常部署的人工复制 URL / Schema / Bearer 流程。

## 职责边界与限制

本模块不创建第二套 Task Store，不直接推进确定性 Task 状态，也不执行真实文件或代码副作用。

## 术语

- Product（产品角色）：负责需求讨论与产品上下文的固定角色。
- Instructions（指令）：约束 Custom GPT 长期行为的角色规则。
- Actions（动作）：Custom GPT 通过 Gateway 调用的受控接口。

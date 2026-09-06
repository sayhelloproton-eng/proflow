# agent-test-ops — 部署 + 测试验收角色包

## 模块定位与作用

为 ProFlow 提供固定的 Test/Ops（测试与运维）Custom GPT 角色定义，负责测试设计、结果检查、发布门禁和运行问题分析。

## 主要能力

- 提供角色 Instructions、开场白和角色专属静态 Action Schema。
- 通过 owning `Module.setup` + `custom-gpt-web-provisioning` 自动创建/更新真实 Private Custom GPT，并由 Agent Domain 注册稳定 Role。
- 校验角色包版本、Role、动态 Auth 与 Actions 接入状态。

## 提供的 API 与 Public Contract

- 不向 Module Graph 提供新的逻辑 Contract。
- 包级 CLI 提供 `setup`、`custom-gpt`、`role` 与 `verify`。

## 依赖的 Module、Contract 和外部资源

- 依赖 `custom-gpt-actions-gateway`，兼容版本 `>=1.0.0 <2.0.0`。
- 依赖 `custom-gpt-web-provisioning`，兼容版本 `>=1.0.0 <2.0.0`，由 Browser Extension 承担部署期 Custom GPT 自动配置。
- 依赖 ChatGPT Custom GPT、Gateway 与可用网络。

## 运行形态与生命周期

类型为 Agent Package，无独立常驻进程；真实会话运行在 ChatGPT。

## 使用方式

`Module.setup` 已接入正式自动创建路径：Role 为 `READY` 时直接复用当前绑定；Role 为 `MISSING` 时由 Agent Runtime 预生成 candidate credential，Extension 在同一个 GPT Editor 内完成 Action Schema、API Key/Bearer、Knowledge ZIP、模型与三项 Capabilities 配置后创建 Private GPT，再由 `saveCurrentRole` 持久化最新 g-id / carrierUrl / credential 并执行 Gateway authenticated probe。`DRIFT` 不自动 Edit 旧 GPT；operator/Browser 完成当前 package material 的远端同步与验证后，运行 `proflow-agent-test-ops role adopt <current-carrier-url> --workspace <workspace>`，由 Agent owner 保持原 roleRef/carrierUrl/credential 并采用当前 package version。

当前角色名固定为 `部署 + 测试验收`；`webSearch / imageGeneration / codeInterpreter` 全部开启；Knowledge 固定上传 `knowledge/custom-gpt-knowledge.zip` 本体。`custom-gpt setup`、`role ...` 与 `verify` 只用于 material 检查、诊断、恢复或显式本地管理，不承担正常部署的人工复制 URL / Schema / Bearer 流程。

## 职责边界与限制

本模块不直接修改仓库、不拥有 Execution Runtime，也不能绕过测试或审批规则宣布业务成功。

## 术语

- Test/Ops（测试与运维）：负责质量、发布与运行保障的固定角色。
- Gate（门禁）：发布或状态推进前必须满足的验证条件。
- Evidence（证据）：由真实执行产生、可追溯的结果记录。

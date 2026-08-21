# agent-product — 产品角色包

## 模块定位与作用

为 ProFlow 提供固定的 Product（产品）Custom GPT 角色定义。它负责需求澄清、维护产品上下文，并通过公开 Actions 与 Task、Agent 协作能力交互。

## 主要能力

- 提供 Product 角色的名称、描述、Instructions、开场白和静态 Action Schema。
- 引导创建或升级真实 Custom GPT，并登记稳定 Role URL。
- 验证角色包版本与本地 Role 注册状态。

## 提供的 API 与 Public Contract

- 不向 Module Graph 提供新的逻辑 Contract。
- 包级 CLI 提供 `setup`、`custom-gpt`、`role` 与 `verify`。

## 依赖的 Module、Contract 和外部资源

- 依赖 `custom-gpt-actions-gateway`，兼容版本 `>=1.0.0 <2.0.0`。
- 依赖 ChatGPT Custom GPT 与公开可达的 Gateway。

## 运行形态与生命周期

类型为 Agent Package，没有独立进程；角色会话由 ChatGPT Carrier 承载。

## 使用方式

运行 `pnpm exec -- proflow-agent-product setup`，按步骤配置角色资料、Instructions、Actions 和真实 GPT URL。

## 职责边界与限制

本模块不创建第二套 Task Store，不直接推进确定性 Task 状态，也不执行真实文件或代码副作用。

## 术语

- Product（产品角色）：负责需求讨论与产品上下文的固定角色。
- Instructions（指令）：约束 Custom GPT 长期行为的角色规则。
- Actions（动作）：Custom GPT 通过 Gateway 调用的受控接口。

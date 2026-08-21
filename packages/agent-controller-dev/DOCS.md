# agent-controller-dev — 总控与研发角色包

## 模块定位与作用

为 ProFlow 提供固定的 Controller/Dev（总控与研发）Custom GPT 角色定义、配置材料和本地 Role 注册入口。该角色负责理解任务、组织研发协作，并通过受控 Execution 完成真实代码操作。

## 主要能力

- 提供角色名称、描述、Instructions（指令）、对话开场白和静态 Action Schema。
- 创建或更新真实 Custom GPT，并把 GPT URL 注册为稳定 Role。
- 校验角色包版本、Role 注册和 Actions Carrier 的一致性。

## 提供的 API 与 Public Contract

- 不向 Module Graph 提供新的逻辑 Contract。
- 包级 CLI 提供 `setup`、`custom-gpt`、`role` 与 `verify` 等角色管理能力。

## 依赖的 Module、Contract 和外部资源

- 依赖 `custom-gpt-actions-gateway`，兼容版本 `>=1.0.0 <2.0.0`。
- 依赖 ChatGPT Custom GPT、公开 HTTPS Gateway 和可用的 ChatGPT 登录状态。

## 运行形态与生命周期

类型为 Agent Package（智能体角色包），没有独立常驻进程；运行状态显示为“无独立进程”。

## 使用方式

运行 `pnpm exec -- proflow-agent-controller-dev setup`，向导会准备角色资料、打开编辑页、复制 Instructions 与 Action Schema，并在保存后登记 GPT URL。

## 职责边界与限制

本模块不保存 Task 业务事实，不直接执行 Shell/Git，也不拥有 Browser Carrier。真实 Effect（副作用）必须交给 Execution。

## 术语

- Controller/Dev（总控与研发）：负责研发组织、实现与技术决策的固定角色。
- Role（角色）：注册到 ProFlow 的稳定 Custom GPT 身份。
- Action Schema（动作接口定义）：限制该角色可调用能力的 OpenAPI 描述。

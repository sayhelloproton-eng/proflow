# chatgpt-carrier — ChatGPT 载体治理

## 模块定位与作用

治理 ProFlow 使用的真实 ChatGPT Custom GPT 载体，观察页面可达性、Actions、认证和必要能力是否满足运行要求。

## 主要能力

- 引导选择真实 Custom GPT 并登记 URL。
- 检查 Actions、OpenAPI、认证和所需 GPT 能力的验证证据。
- 将外部现实映射为“已就绪、需要操作、失败”状态，不伪造在线结果。

## 提供的 API 与 Public Contract

- 不提供新的跨 Module 逻辑 Contract。
- 包级 CLI 提供分步 `setup` 与 `verify`；Module adapter 提供标准七命令管理面。

## 依赖的 Module、Contract 和外部资源

- 依赖 `https://chatgpt.com/`、可用网络、ChatGPT 登录和真实 Custom GPT。
- 角色 Instructions 与角色 Action Schema 由对应 Agent Package 提供。

## 运行形态与生命周期

类型为 External Resource（外部资源）。本地不启动 ChatGPT 进程；状态来自真实 URL 与验证证据。

## 使用方式

运行 `pnpm exec -- proflow-chatgpt-carrier setup`，向导会打开管理页、记录载体并引导验证。

## 职责边界与限制

不自动操作已登录网页，不拥有具体角色内容，也不能仅凭用户口头确认把不可达载体标记为 READY。

## 术语

- Carrier（载体）：承载智能体会话和 Actions 的外部应用。
- Custom GPT（自定义 GPT）：在 ChatGPT 中配置的角色应用。
- READY（已就绪）：外部能力已取得有效验证证据。

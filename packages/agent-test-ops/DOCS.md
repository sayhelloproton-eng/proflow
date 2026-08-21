# agent-test-ops — 测试与运维角色包

## 模块定位与作用

为 ProFlow 提供固定的 Test/Ops（测试与运维）Custom GPT 角色定义，负责测试设计、结果检查、发布门禁和运行问题分析。

## 主要能力

- 提供角色 Instructions、开场白和角色专属静态 Action Schema。
- 引导创建或更新真实 Custom GPT，并注册 Role URL。
- 校验角色包版本、角色注册和 Actions 接入状态。

## 提供的 API 与 Public Contract

- 不向 Module Graph 提供新的逻辑 Contract。
- 包级 CLI 提供 `setup`、`custom-gpt`、`role` 与 `verify`。

## 依赖的 Module、Contract 和外部资源

- 依赖 `custom-gpt-actions-gateway`，兼容版本 `>=1.0.0 <2.0.0`。
- 依赖 ChatGPT Custom GPT、Gateway 与可用网络。

## 运行形态与生命周期

类型为 Agent Package，无独立常驻进程；真实会话运行在 ChatGPT。

## 使用方式

运行 `pnpm exec -- proflow-agent-test-ops setup`，向导会逐步准备并验证角色配置。

## 职责边界与限制

本模块不直接修改仓库、不拥有 Execution Runtime，也不能绕过测试或审批规则宣布业务成功。

## 术语

- Test/Ops（测试与运维）：负责质量、发布与运行保障的固定角色。
- Gate（门禁）：发布或状态推进前必须满足的验证条件。
- Evidence（证据）：由真实执行产生、可追溯的结果记录。

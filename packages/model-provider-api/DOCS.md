# model-provider-api — 模型服务适配器

## 模块定位与作用

治理一个真实 OpenAI-compatible（兼容 OpenAI 协议）模型服务端点，并向模型领域发布经过探测的 Provider 连接事实。

## 主要能力

- 校验 Base URL 格式并探测服务连通性与认证状态。
- 保存 Module-owned Provider 配置，避免 Platform 成为配置总线。
- 发布不含明文凭据的 Provider shared facts。

## 提供的 API 与 Public Contract

- 提供 `model.provider.api` Contract，版本 `1.0.0`。
- Contract 表达通用 Provider 端点，不绑定 FAST/REASON 模型选择。

## 依赖的 Module、Contract 和外部资源

- 依赖真实模型服务、网络和服务支持的安全认证方式。
- 无上游 Module Contract 依赖。

## 运行形态与生命周期

类型为 External Resource；远端服务进程不由 ProFlow 启停，模块负责配置和观察。

## 使用方式

运行 `pnpm exec -- proflow-model-provider-api setup`，输入 Base URL 后立即执行协议和连通性验证。

## 职责边界与限制

不选择模型角色，不保存不受支持的明文密钥，也不把仅可连接误判为模型能力完全合格。

## 术语

- Provider（模型服务商）：提供模型 API 的外部系统。
- Base URL（基础地址）：OpenAI-compatible API 的服务入口。
- Shared Fact（共享事实）：由 Owner Module 发布给依赖方的当前事实。

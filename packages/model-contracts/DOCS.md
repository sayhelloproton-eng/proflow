# model-contracts — 模型领域契约类型

## 模块定位与作用

定义模型请求、角色、Provider 观察、推理结果和错误的稳定类型，隔离具体厂商协议与调用方。

## 主要能力

- 定义 FAST、REASON、AUTO 等模型角色语义。
- 提供请求、响应、健康和能力观察的运行时 Schema。
- 统一 Provider 错误、超时和不可用结果。

## 提供的 API 与 Public Contract

- 不在 Module Graph 中声明独立逻辑 Contract；通过包 exports 提供类型与 Schema。
- `model-inference` 的运行接口由 model-runtime 提供。

## 依赖的 Module、Contract 和外部资源

- 无上游 Module Contract 或外部服务依赖。
- 运行时要求 Node.js 24.19.0 或更高版本。

## 运行形态与生命周期

类型为 Library，无独立进程和持久化状态。

## 使用方式

模型 Runtime、Execution 和诊断调用方通过公开包入口导入类型与校验器。

## 职责边界与限制

不选择真实模型、不调用 Provider、不保存凭据，也不赋予模型业务决策权。

## 术语

- Model Role（模型角色）：按用途定义的 FAST、REASON 或 AUTO 选择语义。
- Provider Observation（服务观察）：对远端能力和可用性的当前验证结果。

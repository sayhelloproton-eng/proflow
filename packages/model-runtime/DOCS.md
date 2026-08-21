# model-runtime — 模型推理运行时

## 模块定位与作用

把 Provider 提供的真实模型映射为 FAST（快速）与 REASON（推理）两个稳定角色，并提供统一、可验证的模型推理入口。

## 主要能力

- 读取 Provider 能力并验证候选模型。
- 管理 FAST/REASON 角色选择、请求路由、超时和错误归一化。
- 启动本地认证服务并暴露健康状态。

## 提供的 API 与 Public Contract

- 提供 `model-inference` Contract，版本 `1.0.0`。
- 对外提供按 FAST/REASON/AUTO 策略调用模型的推理接口。

## 依赖的 Module、Contract 和外部资源

- 依赖 `model.provider.api`，兼容版本 `>=1.0.0 <2.0.0`。
- 依赖 Provider 中真实存在并通过能力验证的模型 ID。

## 运行形态与生命周期

类型为 Service，配置 READY 后由 `platform start` 启动独立本地进程。

## 使用方式

先完成 Provider setup，再运行 `pnpm exec -- proflow-model-runtime setup` 选择并验证 FAST 与 REASON 模型。

## 职责边界与限制

不拥有业务工作流、不让模型结果直接覆盖 Owner 事实，也不接收 Provider 内部路径作为公开配置。

## 术语

- FAST（快速模型）：面向低延迟、低成本工作的模型角色。
- REASON（推理模型）：面向复杂分析与诊断的模型角色。
- Inference（推理）：向模型发出请求并取得结构化结果的过程。

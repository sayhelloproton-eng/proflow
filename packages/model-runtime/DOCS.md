# model-runtime — 模型推理运行时

## 模块定位与作用

把 Provider 的真实 inventory 映射为 FAST（快速）与 THINK（推理）两个稳定逻辑角色，并提供统一、可验证的推理服务。

## 主要能力

- 从 `model-provider-api` shared facts 读取已验证 endpoint、inventory 和 secret file reference；不要求用户复制地址、凭据或模型 ID。
- 对 inventory 候选执行真实、有界、串行能力验证，并在模型之间默认冷却 5 秒，避免手机连续验证拥塞。
- FAST 必须实测 text、Vision、structured output、no-thinking 及最小 context/output 条件；THINK 必须实测 text、structured output、thinking 及最小 context/output 条件。
- 先用能力证据筛选，再用可解释的元数据作次级消歧；无法唯一决定时只对歧义角色 ACTION_REQUIRED，人工选择仍必须来自证据合格集合。
- 持久化 inventory fingerprint、FAST/THINK 映射、Capability Profile、原始验证证据和时间。inventory 漂移或证据过期时 fail closed 并重新验证；输入不变且证据新鲜时复用映射。
- setup READY、进程运行态和 Provider 可用性分别观察；本地 `/ready` 仅在 runtime 依赖真实 READY 时返回就绪。

## 提供的 API 与 Public Contract

- 提供 `model-inference` Contract，版本 `1.0.0`。
- 对外按 FAST/THINK/AUTO 策略调用模型；模型结果没有业务工作流或 Effect authority。

## 依赖的 Module、Contract 和外部资源

- 依赖 `model.provider.api` Contract，兼容版本 `>=1.0.0 <2.0.0`。
- 依赖 Provider 中真实存在、协议可访问且通过能力验证的候选模型。

## 运行形态与生命周期

类型为 Service。setup 只建立并持久化可验证配置；start 启动带 transport credential 的独立本地 HTTP 进程，status 和 stop 观察、终止实际进程。

## 使用方式

先完成 Provider setup，再执行：

```text
platform setup
platform status
```

正常路径不填写模型 ID。命令只在多个已验证候选仍无法区分时给出一次精确选择入口。

## 职责边界与限制

模块不拥有业务工作流、不让模型结果覆盖 Owner 事实、不把 Provider 内部路径作为公开业务配置，也不以 mock、静态清单或旧映射证明真实手机服务 READY。

## 术语

- FAST：必须满足 no-thinking、text、Vision、structured output 和最小容量证据的逻辑角色。
- THINK：必须满足 thinking、text、structured output 和最小容量证据的逻辑角色（内部兼容字段仍可使用 `reason`）。
- Capability evidence：对真实候选发出有界请求后获得的能力观测，不是模型名称推断。
- Inventory fingerprint：用于判断已验证映射输入是否发生漂移的稳定摘要。

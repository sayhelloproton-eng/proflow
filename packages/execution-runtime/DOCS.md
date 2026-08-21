# execution-runtime — 执行服务

## 模块定位与作用

接收标准 Execution Intent，选择 Local 或 Browser Executor，管理执行、恢复和 Evidence，并向其他领域提供唯一真实副作用入口。

## 主要能力

- 校验 Intent、权限、幂等键和执行状态。
- 路由本地与浏览器执行能力，统一结果与失败恢复。
- 持久化执行记录和 Evidence，提供认证的本地服务接口。

## 提供的 API 与 Public Contract

- 提供 `execution` Contract，版本 `1.0.0`。
- 对外提供请求执行、查询结果和读取证据的应用接口。

## 依赖的 Module、Contract 和外部资源

- 依赖 `execution-local`，兼容版本 `>=1.0.0 <2.0.0`。
- Browser Effect 还需要 execution-browser-extension 发布的 Executor shared fact。

## 运行形态与生命周期

类型为 Service，配置 READY 后由 `platform start` 启动独立认证进程。

## 使用方式

先完成 Local、Browser 和上游 shared facts 配置，再由 Platform Host 或 Agent Gateway 通过公开 Contract 调用。

## 职责边界与限制

不拥有 Task 状态、不让 Browser 成为第二个 durable runtime，也不把模型判断当成执行成功证据。

## 术语

- Executor（执行器）：实现某类真实 Effect 的受控端口。
- Idempotency（幂等性）：相同请求重试不会重复产生不可控副作用。
- Recovery（恢复）：在中断或结果不确定后重新观察并安全继续。

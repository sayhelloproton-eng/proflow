# platform-host — 平台组合服务

## 模块定位与作用

ProFlow 的本地 Composition Root（组合根），把 Task、Agent、Execution 和 Model 的公开端口装配为受认证的本地 HTTP 服务。

## 主要能力

- 构造领域应用服务、Store 和跨域 Public Contract 适配器。
- 提供本地认证、健康检查和共享事实。
- 统一管理组合进程的启动、停止和恢复。

## 提供的 API 与 Public Contract

- 提供 `platform-host` Contract，版本 `1.0.0`。
- 对 Agent Gateway 和 Browser Extension 暴露受认证的本地应用 API。

## 依赖的 Module、Contract 和外部资源

- 依赖 `task-orchestration`、`agent-runtime`、`execution` 和 `model-inference`，兼容版本均为 `>=1.0.0 <2.0.0`。

## 运行形态与生命周期

类型为 Service，由 `platform start` 启动独立本地进程并监听 loopback 地址。

## 使用方式

所有依赖 Module READY 后通过 Platform 生命周期启动；下游从 shared facts 获取端点和凭据路径。

## 职责边界与限制

不成为第五领域的业务 Owner，不暴露数据库，不把公网入口或外部 Provider 配置收进自身私有配置。

## 术语

- Composition Root（组合根）：集中创建并连接应用组件的工程入口。
- Loopback（本机回环）：仅当前主机可访问的网络地址。

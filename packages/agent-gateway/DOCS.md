# agent-gateway

Agent Gateway（智能体网关）是 Custom GPT Actions 的公网入口。它校验角色身份、请求格式和权限，再把请求转发给 ProFlow 内部服务。

## 什么时候需要

当 Custom GPT 需要调用 ProFlow 的任务、协作或执行能力时，必须启动该服务。

## 使用前提

- Platform Host（平台主服务）已经就绪。
- Dev Tunnel（开发隧道）已经提供可公开访问的 HTTPS 地址。

网关不保存业务数据；配置完成后使用 `platform start` 统一启动。

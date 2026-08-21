# agent-gateway — 智能体动作网关

## 模块定位与作用

Agent Gateway（智能体网关）是 Custom GPT Actions 的唯一公网入口。它负责认证角色身份、校验请求、路由到领域 Public API，并把结果规范化返回 ChatGPT。

## 主要能力

- 校验 Role Bearer Key、请求 Schema、权限和版本。
- 路由 Task、Agent Runtime 与 Execution 的公开能力。
- 暴露静态 OpenAPI 所需的 HTTPS Action 接口，不保存业务数据。

## 提供的 API 与 Public Contract

- 提供 `custom-gpt-actions-gateway` Contract，版本 `1.0.0`。
- 对外提供 Custom GPT Actions HTTP API；内部只调用已声明的领域 Contract。

## 依赖的 Module、Contract 和外部资源

- 依赖 `agent-runtime`、`task-orchestration`、`execution`、`platform-host` 和 `public-ingress`，兼容版本均为 `>=1.0.0 <2.0.0`。

## 运行形态与生命周期

类型为 Service（服务），由独立进程监听本地端口，经 Dev Tunnel 暴露公开 HTTPS 地址。

## 使用方式

完成 Platform Host 与 Dev Tunnel 配置后运行 `platform start`。Custom GPT 使用各自 Role Key 调用该网关。

## 职责边界与限制

不直接读取数据库、不执行 Shell/Git、不推进 Task，也不拥有 Tunnel 登录和域名生命周期。

## 术语

- Gateway（网关）：外部协议与内部领域接口之间的受控适配层。
- Public Ingress（公网入口）：由 Dev Tunnel 提供的 HTTPS 访问能力。
- Bearer Key（持有者凭据）：用于识别固定 Role 的认证信息。

# dev-tunnel — 开发隧道

## 模块定位与作用

使用 Microsoft Dev Tunnels 把本地 Agent Gateway 安全映射为公开 HTTPS 入口，供 Custom GPT Actions 调用。

## 主要能力

- 检查 `devtunnel` CLI 与 Microsoft 登录状态。
- 列出、选择或创建持久 Tunnel，并管理端口映射和运行进程。
- 观察公开 HTTPS URL，将其发布为共享事实。

## 提供的 API 与 Public Contract

- 提供 `public-ingress` Contract，版本 `1.0.0`。
- 共享当前 Tunnel ID 与公开 Base URL，不暴露账号凭据。

## 依赖的 Module、Contract 和外部资源

- 依赖 Microsoft `devtunnel` CLI、账号登录、网络和本地 Platform Host 端口。
- 无上游 Module Contract 依赖。

## 运行形态与生命周期

类型为 External Resource，拥有可启动和停止的 Tunnel 子进程；持久 Tunnel 本身在卸载时保留。

## 使用方式

运行 `pnpm exec -- proflow-dev-tunnel setup`，向导会完成登录检查、Tunnel 选择/创建、端口映射和 URL 验证。

## 职责边界与限制

不拥有 Agent Gateway 业务、不复制 Role Key，也不把临时 Quick Tunnel 当成正式持久入口。

## 术语

- Tunnel（隧道）：把本地端口映射到公网 HTTPS 地址的连接。
- Public Ingress（公网入口）：外部服务访问本地 Gateway 的受控入口。
- Persistent Tunnel（持久隧道）：具有稳定 ID、可重复启动的 Tunnel。

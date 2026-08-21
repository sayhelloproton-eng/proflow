# dev-tunnel

Dev Tunnel（开发隧道）把本机 Agent Gateway 安全地映射为公开 HTTPS 地址，供 Custom GPT Actions 调用。

## 什么时候需要

当 ProFlow 在本机运行，而 Custom GPT 需要从互联网访问本机网关时使用。

## 如何配置

运行 `pnpm exec -- proflow-dev-tunnel setup`。向导会检查 `devtunnel` 工具和登录状态，列出现有 Tunnel（隧道），协助选择或创建持久隧道，然后保存并验证公开地址。

公开地址会被外部服务访问，请只暴露 ProFlow 网关需要的端口。

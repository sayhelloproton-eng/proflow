# @tomflow/proflow-agent-gateway — Module Setup

## STEP-AGENT-GATEWAY-01 — 准备公开入口

Responsible: AI
Interactive executable: `platform setup --module dev-tunnel`
Non-interactive executable: `platform setup --module dev-tunnel`
Required inputs: none；`publicBaseUrl` 必须由 `dev-tunnel` shared facts 自动提供，禁止用户复制 Tunnel ID、端口或 URL
Verify: `platform status`
Success condition: `dev-tunnel.setupStatus=READY`.

## STEP-AGENT-GATEWAY-02 — 启动平台主服务

Responsible: AI
Interactive executable: `platform setup --module platform-host`
Non-interactive executable: `platform setup --module platform-host`
Required inputs: none
Verify: `platform status`
Success condition: `platform-host.setupStatus=READY`.

本模块只重新观察 `dev-tunnel` 与 `platform-host` 的 producer-owned shared facts；依赖未就绪时返回 `BLOCKED`，不把内部 endpoint、state path 或 credential path 暴露为人工配置。

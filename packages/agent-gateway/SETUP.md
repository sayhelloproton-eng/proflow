# @tomflow/proflow-agent-gateway — Module Setup

## STEP-AGENT-GATEWAY-01 — 准备公开入口

Responsible: EXTERNAL
Interactive executable: `platform setup --module dev-tunnel`
Non-interactive executable: `platform setup --module dev-tunnel`
Required inputs: persistent Tunnel and public HTTPS URL
Verify: `platform status`
Success condition: `dev-tunnel.setupStatus=READY`.

## STEP-AGENT-GATEWAY-02 — 启动平台主服务

Responsible: AI
Interactive executable: `platform setup --module platform-host`
Non-interactive executable: `platform setup --module platform-host`
Required inputs: none
Verify: `platform status`
Success condition: `platform-host.setupStatus=READY`.

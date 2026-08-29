# dev-tunnel Setup

## STEP-DEV-TUNNEL-01 — 自动准备 Microsoft Dev Tunnel

Responsible: AI

Interactive executable: `platform setup`

Non-interactive lifecycle entry: `platform setup --workspace <path>`

Required inputs: none

Human action: 仅当现有登录无效时，在 `devtunnel user login --github --use-browser-auth` 打开的浏览器页面完成 GitHub 授权。

Automatic flow:

```text
检查 CLI 和登录
→ 必要时完成 GitHub browser auth 并复核登录
→ 复用 workspace-owned Tunnel 或自动创建
→ 从 agent-gateway shared facts 读取本地端口
→ 自动对齐 port mapping
→ 启动或复用 host
→ 自动发现当前端口的 HTTPS URL
→ 持久化并发布 tunnelId/publicBaseUrl
```

Verify: `platform status`

Success condition: `dev-tunnel.setupStatus=READY`.

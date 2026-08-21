# dev-tunnel Setup

## STEP-DEV-TUNNEL-01 — 检查 Dev Tunnel CLI 与登录
Responsible: USER
Interactive executable: `pnpm exec -- proflow-dev-tunnel setup 01`
Non-interactive executable: `pnpm exec -- proflow-dev-tunnel setup 01`
Required inputs: Microsoft 登录
Verify: `devtunnel user show`
Success condition: Microsoft 登录状态可被 CLI 观察。

## STEP-DEV-TUNNEL-02 — 选择或创建持久 Tunnel
Responsible: USER
Interactive executable: `pnpm exec -- proflow-dev-tunnel setup 02`
Non-interactive executable: `pnpm exec -- proflow-dev-tunnel setup 02 --tunnel-id <id>`
Required inputs: Tunnel ID
Verify: `devtunnel show <id>`
Success condition: 持久 Tunnel 可以被 devtunnel show 观察。

## STEP-DEV-TUNNEL-03 — 配置入口并保存公开 URL
Responsible: USER
Interactive executable: `pnpm exec -- proflow-dev-tunnel setup 03`
Non-interactive executable: `pnpm exec -- proflow-dev-tunnel setup 03 --tunnel-id <id> --public-base-url <url>`
Required inputs: Tunnel ID、公开 HTTPS URL
Verify: `pnpm exec -- proflow-dev-tunnel verify`
Success condition: 公开 HTTPS URL 已保存并可验证。

## STEP-DEV-TUNNEL-04 — 验证 Dev Tunnel
Responsible: AI
Interactive executable: `pnpm exec -- proflow-dev-tunnel setup 04`
Non-interactive executable: `pnpm exec -- proflow-dev-tunnel verify`
Required inputs: none
Verify: `pnpm exec -- proflow-dev-tunnel verify`
Success condition: `dev-tunnel.setupStatus=READY`.

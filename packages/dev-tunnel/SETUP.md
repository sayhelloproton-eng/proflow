# @tomflow/proflow-dev-tunnel — Module Setup

## STEP-DEV-TUNNEL-01 — 选择或创建持久 Tunnel

Responsible: USER
Interactive executable: `pnpm exec -- proflow-dev-tunnel setup`
Non-interactive executable: `pnpm exec -- proflow-dev-tunnel setup --tunnel-id <id> --public-base-url <url>`
Required inputs: Tunnel ID、公开 HTTPS URL
Verify: `pnpm exec -- proflow-dev-tunnel verify`
Success condition: `dev-tunnel.setupStatus=READY`.

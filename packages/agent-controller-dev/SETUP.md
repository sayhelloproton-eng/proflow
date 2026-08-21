# @tomflow/proflow-agent-controller-dev — Module Setup

## STEP-AGENT-CONTROLLER-DEV-01 — 创建并注册 Custom GPT Role

Responsible: USER
Interactive executable: `pnpm exec -- proflow-agent-controller-dev setup`
Non-interactive executable: `pnpm exec -- proflow-agent-controller-dev setup --carrier-url <url>`
Required inputs: Custom GPT URL
Verify: `pnpm exec -- proflow-agent-controller-dev verify`
Success condition: `agent-controller-dev.setupStatus=READY`.

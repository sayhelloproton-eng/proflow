# @tomflow/proflow-agent-product — Module Setup

## STEP-AGENT-PRODUCT-01 — 创建并注册 Custom GPT Role

Responsible: USER
Interactive executable: `pnpm exec -- proflow-agent-product setup`
Non-interactive executable: `pnpm exec -- proflow-agent-product setup --carrier-url <url>`
Required inputs: Custom GPT URL
Verify: `pnpm exec -- proflow-agent-product verify`
Success condition: `agent-product.setupStatus=READY`.

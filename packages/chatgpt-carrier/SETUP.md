# @tomflow/proflow-chatgpt-carrier — Module Setup

## STEP-CHATGPT-CARRIER-01 — 创建或选择并验证 Custom GPT

Responsible: USER
Interactive executable: `pnpm exec -- proflow-chatgpt-carrier setup`
Non-interactive executable: `pnpm exec -- proflow-chatgpt-carrier setup --carrier-url <url>`
Required inputs: Custom GPT URL
Verify: `pnpm exec -- proflow-chatgpt-carrier verify`
Success condition: `chatgpt-carrier.setupStatus=READY`.

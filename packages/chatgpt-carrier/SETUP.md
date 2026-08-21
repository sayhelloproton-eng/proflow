# chatgpt-carrier Setup

## STEP-CHATGPT-CARRIER-01 — 选择真实 Custom GPT
Responsible: USER
Interactive executable: `pnpm exec -- proflow-chatgpt-carrier setup 01`
Non-interactive executable: `pnpm exec -- proflow-chatgpt-carrier setup 01 --carrier-url <url>`
Required inputs: Custom GPT URL
Verify: `pnpm exec -- proflow-chatgpt-carrier setup 01 --carrier-url <url>`
Success condition: 真实 Carrier URL 已保存。

## STEP-CHATGPT-CARRIER-02 — 检查 Carrier 能力
Responsible: USER
Interactive executable: `pnpm exec -- proflow-chatgpt-carrier setup 02`
Non-interactive executable: `pnpm exec -- proflow-chatgpt-carrier setup 02 --confirm-capabilities`
Required inputs: none
Verify: `pnpm exec -- proflow-chatgpt-carrier verify`
Success condition: Carrier 能力检查已记录。

## STEP-CHATGPT-CARRIER-03 — 验证 Carrier
Responsible: AI
Interactive executable: `pnpm exec -- proflow-chatgpt-carrier setup 03`
Non-interactive executable: `pnpm exec -- proflow-chatgpt-carrier verify`
Required inputs: none
Verify: `pnpm exec -- proflow-chatgpt-carrier verify`
Success condition: `chatgpt-carrier.setupStatus=READY`.

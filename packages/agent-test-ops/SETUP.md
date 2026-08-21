# @tomflow/proflow-agent-test-ops — Module Setup

## STEP-AGENT-TEST-OPS-01 — 创建并注册 Custom GPT Role

Responsible: USER
Interactive executable: `pnpm exec -- proflow-agent-test-ops setup`
Non-interactive executable: `pnpm exec -- proflow-agent-test-ops setup --carrier-url <url>`
Required inputs: Custom GPT URL
Verify: `pnpm exec -- proflow-agent-test-ops verify`
Success condition: `agent-test-ops.setupStatus=READY`.

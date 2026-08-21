# agent-product Setup

## STEP-AGENT-PRODUCT-01 — 创建 Custom GPT 并注册 Role URL
Responsible: USER
Interactive executable: `pnpm exec -- proflow-agent-product setup 01`
Non-interactive executable: `pnpm exec -- proflow-agent-product setup 01 --carrier-url <url>`
Required inputs: Custom GPT URL
Verify: `pnpm exec -- proflow-agent-product setup 01`
Success condition: Role URL 已写入 Module-owned 注册表。

## STEP-AGENT-PRODUCT-02 — 配置角色 Instructions
Responsible: USER
Interactive executable: `pnpm exec -- proflow-agent-product setup 02`
Non-interactive executable: `pnpm exec -- proflow-agent-product custom-gpt show-instructions`
Required inputs: none
Verify: `pnpm exec -- proflow-agent-product setup 02`
Success condition: 当前 Instructions 已保存。

## STEP-AGENT-PRODUCT-03 — 配置 Action Schema 与认证
Responsible: USER
Interactive executable: `pnpm exec -- proflow-agent-product setup 03`
Non-interactive executable: `pnpm exec -- proflow-agent-product setup 03 --gateway-url <url>`
Required inputs: Gateway URL
Verify: `pnpm exec -- proflow-agent-product role validate`
Success condition: Actions 与认证已保存。

## STEP-AGENT-PRODUCT-04 — 验证 Role 配置
Responsible: AI
Interactive executable: `pnpm exec -- proflow-agent-product setup 04`
Non-interactive executable: `pnpm exec -- proflow-agent-product verify`
Required inputs: none
Verify: `pnpm exec -- proflow-agent-product verify`
Success condition: `agent-product.setupStatus=READY`.

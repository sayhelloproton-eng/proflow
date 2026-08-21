# @tomflow/proflow-model-provider-api — Module Setup

## STEP-MODEL-PROVIDER-API-01 — 配置并验证模型服务

Responsible: USER
Interactive executable: `pnpm exec -- proflow-model-provider-api setup`
Non-interactive executable: `pnpm exec -- proflow-model-provider-api setup --provider-base-url <url>`
Required inputs: 模型服务 Base URL
Verify: `pnpm exec -- proflow-model-provider-api verify`
Success condition: `model-provider-api.setupStatus=READY`.

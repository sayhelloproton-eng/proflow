# model-provider-api Setup

## STEP-MODEL-PROVIDER-API-01 — 配置模型服务地址
Responsible: USER
Interactive executable: `pnpm exec -- proflow-model-provider-api setup 01`
Non-interactive executable: `pnpm exec -- proflow-model-provider-api setup 01 --provider-base-url <url>`
Required inputs: Provider Base URL
Verify: `pnpm exec -- proflow-model-provider-api verify`
Success condition: Provider Base URL 已通过连接与认证探测。

## STEP-MODEL-PROVIDER-API-02 — 验证模型服务
Responsible: AI
Interactive executable: `pnpm exec -- proflow-model-provider-api setup 02`
Non-interactive executable: `pnpm exec -- proflow-model-provider-api verify`
Required inputs: none
Verify: `pnpm exec -- proflow-model-provider-api verify`
Success condition: `model-provider-api.setupStatus=READY`.

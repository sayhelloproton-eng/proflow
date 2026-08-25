# model-provider-api Setup

## STEP-MODEL-PROVIDER-API-01 — 绑定并验证模型服务 URL

Responsible: AI
Interactive executable: `pnpm exec -- proflow-model-provider-api setup`
Non-interactive executable: `pnpm exec -- proflow-model-provider-api setup --provider-base-url <url>`
Required inputs: 部署层解析出的 OpenAI-compatible HTTP(S) Provider URL
Verify: `pnpm exec -- proflow-model-provider-api verify`
Success condition: URL 通过真实 models endpoint、协议和 inventory 校验，`model-provider-api.setupStatus=READY`。

本模块不负责发现地址，也不识别设备、应用或 Provider 产品。完整 Platform 部署应把解析出的 URL 直接转交本模块；独立 CLI 调试时才允许显式传入 `--provider-base-url`。

## STEP-MODEL-PROVIDER-API-02 — 仅在服务要求时完成认证

Responsible: USER
Interactive executable: `pnpm exec -- proflow-model-provider-api setup`
Non-interactive executable: `pnpm exec -- proflow-model-provider-api setup --provider-base-url <url> --provider-credential-file <owner-only-path>`
Required inputs: 仅当真实 Provider 返回认证要求时，安全输入一次访问凭据
Verify: `pnpm exec -- proflow-model-provider-api verify`
Success condition: `model-provider-api.setupStatus=READY`。

- 凭据文件在非 Windows 系统上必须仅允许 owner 读取。
- shared facts 只发布 credential file reference，不发布明文。
- 已绑定 URL 每次 `status` 都会重新 probe；不可达时不会凭历史 evidence 继续 READY。

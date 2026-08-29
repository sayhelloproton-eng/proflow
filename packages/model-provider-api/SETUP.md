# model-provider-api Setup

## STEP-MODEL-PROVIDER-API-01 — 绑定并验证模型服务 URL

Responsible: DEPLOYMENT_OWNER
Interactive executable: `platform setup`
Non-interactive executable: `platform setup`
Required inputs: 尚未配置时，由用户提供一次 OpenAI-compatible HTTP(S) Base URL；不要填写网页地址、单个模型地址或 `/chat/completions` 操作地址
Verify: `platform status`
Success condition: URL 通过真实 models endpoint、协议和 inventory 校验，`model-provider-api.setupStatus=READY`。

本模块只认通用 Provider URL，不发现或识别设备、应用、厂商或 Provider 产品。正常 Platform 路径只在缺少 URL 时询问这一项，并把 URL 直接转交本模块完成真实探测；若 Provider 明确要求认证，再进入下一步凭据输入。

## STEP-MODEL-PROVIDER-API-02 — 仅在服务要求时完成认证

Responsible: USER
Interactive executable: `platform setup`
Non-interactive executable: `platform setup`
Required inputs: 仅当真实 Provider 返回认证要求时，安全输入一次访问凭据
Verify: `platform status`
Success condition: `model-provider-api.setupStatus=READY`。

- 凭据文件在非 Windows 系统上必须仅允许 owner 读取。
- shared facts 只发布 credential file reference，不发布明文。
- 已绑定 URL 每次 `status` 都会重新 probe；不可达时不会凭历史 evidence 继续 READY。

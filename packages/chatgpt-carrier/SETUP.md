# chatgpt-carrier Setup

## STEP-CHATGPT-CARRIER-01 — 自动观察 ChatGPT Web

Responsible: AI
Interactive executable: `platform setup --module chatgpt-carrier`
Non-interactive executable: `platform setup --module chatgpt-carrier --workspace <workspace>`
Required inputs: none
Verify: `pnpm exec -- proflow-chatgpt-carrier verify --workspace <workspace>`
Success condition: `chatgpt-carrier.setupStatus=READY`，且当前 ChatGPT Web reachability 已由机器重新观察。

本模块不再要求用户：
- 选择或粘贴 Custom GPT URL；
- 人工确认 Actions / OpenAPI / Bearer / File Bridge / Capabilities；
- 维护编号式 `setup 01/02/03` 状态。

具体 GPT 的创建、Auth、Knowledge、Capabilities 与 Role readiness 由三个 Agent Package + Browser Extension + Agent Runtime owning flow 闭环。只有 ChatGPT Web 当前网络/平台可用性无法确认时，本模块才返回 `ACTION_REQUIRED`。
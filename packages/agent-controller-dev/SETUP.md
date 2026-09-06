# agent-controller-dev Setup

> Real-2 冻结合同：`Module.setup` 已完成真实 Custom GPT 自动部署闭环。`READY` 直接复用；`MISSING` 自动走 candidate credential → 单 Editor 配置 Auth/Schema/Knowledge/Capabilities → Private Create → `saveCurrentRole` → Gateway probe；`DRIFT` 不自动编辑旧 GPT，必须 fail closed。远端原 GPT 经 operator/Browser 明确同步后，使用 package-scoped `role adopt` 保持 identity/credential 并采用当前版本。

## STEP-AGENT-CONTROLLER-DEV-01 — Module.setup 自动部署合同
Responsible: AI
Interactive executable: `platform setup --module agent-controller-dev`
Non-interactive executable: `platform setup --module agent-controller-dev --workspace <workspace>`
Required inputs: none
Verify: `pnpm exec -- proflow-agent-controller-dev verify --workspace <workspace>`
Success condition: `agent-controller-dev.setupStatus=READY`，且真实 GPT、Role、Auth 与 Gateway probe 均已通过 owning Module 验证。

Package-specific extra capability 只用于诊断/恢复：`custom-gpt setup` 输出版本化 Provisioning material；`role ...` 与 `verify` 用于本地 Role/credential 状态检查。正常部署不使用 `custom-gpt finalize-role`，也不要求用户人工复制 Instructions / Schema / URL / Bearer。Extension 未 READY 时先处理 `execution-browser-extension` 的加载/连接事实。

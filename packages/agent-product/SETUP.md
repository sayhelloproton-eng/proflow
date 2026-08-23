# agent-product Setup

> B1～B5 封板状态：本包已经提供完整 Provisioning material 与 Role/Auth finalization primitive；当前 `Module.setup` 仍只观察 durable Role reality，缺失/漂移时返回 `ACTION_REQUIRED`。B6 负责把下述最终合同接入 `platform setup` 并验证重入/no-duplicate/Fresh Workspace。该边界不允许恢复人工复制 URL / Schema / Bearer 作为 happy path。

## STEP-AGENT-PRODUCT-01 — 最终 Module.setup 自动部署合同（B6 集成/验收）
Responsible: AI
Interactive executable: `platform setup --module agent-product`
Non-interactive executable: `platform setup --module agent-product --workspace <workspace>`
Required inputs: none
Verify: `pnpm exec -- proflow-agent-product verify --workspace <workspace>`
Success condition: `agent-product.setupStatus=READY`，且真实 GPT、Role、Auth 与 Gateway probe 均已通过 owning Module 验证。

Package-specific extra capability 只用于诊断/恢复：`custom-gpt setup` 输出版本化 Provisioning material；`custom-gpt finalize-role --workspace <workspace> --carrier-url <url>` 接收机器产生的 live carrier URL，调用 Agent owner 完成 Role/Auth 最终化。Extension 未 READY 时先处理 `execution-browser-extension` 的唯一人工动作“加载已解压的扩展程序”，不回退到手工 Web 配置。

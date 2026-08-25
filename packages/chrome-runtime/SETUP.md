# @tomflow/proflow-chrome-runtime — Module Setup

## STEP-CHROME-RUNTIME-01 — 自动确保 Chrome

Responsible: AI
Interactive executable: `platform install`
Non-interactive executable: `platform install`
Required inputs: none
Verify: `platform status`
Success condition: `chrome-runtime.setupStatus=READY` 且真实 Chrome version probe 成功。

正常路径不要求用户输入 Chrome 路径。Chrome 已存在时直接复用；macOS 缺失时 ProFlow 自动从 Google 官方 Stable DMG 安装并再次验证。安装失败时不伪造 READY，重新运行 `platform install` 才是稳定恢复入口。Browser Extension 的 Developer Mode / Load unpacked 操作不属于本模块。

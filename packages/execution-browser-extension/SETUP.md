# execution-browser-extension Setup

## STEP-EXECUTION-BROWSER-EXTENSION-01 — 准备扩展并打开 Chrome
Responsible: USER
Interactive executable: `pnpm exec -- proflow-execution-browser-extension setup 01`
Non-interactive executable: `pnpm exec -- proflow-execution-browser-extension setup 01`
Required inputs: none
Verify: `pnpm exec -- proflow-execution-browser-extension setup 01`
Success condition: 扩展目录已生成并可选择。

## STEP-EXECUTION-BROWSER-EXTENSION-02 — 登记 Extension ID 并生成配置
Responsible: USER
Interactive executable: `pnpm exec -- proflow-execution-browser-extension setup 02`
Non-interactive executable: `pnpm exec -- proflow-execution-browser-extension setup 02 --extension-id <id>`
Required inputs: Chrome Extension ID
Verify: `pnpm exec -- proflow-execution-browser-extension verify`
Success condition: Extension ID 和运行配置已保存。

## STEP-EXECUTION-BROWSER-EXTENSION-03 — 验证 Service Worker 与 Bridge
Responsible: AI
Interactive executable: `pnpm exec -- proflow-execution-browser-extension setup 03`
Non-interactive executable: `pnpm exec -- proflow-execution-browser-extension verify`
Required inputs: none
Verify: `pnpm exec -- proflow-execution-browser-extension verify`
Success condition: `execution-browser-extension.setupStatus=READY`.

# @tomflow/proflow-execution-browser-extension — Module Setup

## STEP-EXECUTION-BROWSER-EXTENSION-01 — 加载并验证 Chrome 扩展

Responsible: USER
Interactive executable: `pnpm exec -- proflow-execution-browser-extension setup`
Non-interactive executable: `pnpm exec -- proflow-execution-browser-extension setup --extension-id <id>`
Required inputs: Chrome Extension ID
Verify: `pnpm exec -- proflow-execution-browser-extension verify`
Success condition: `execution-browser-extension.setupStatus=READY`.

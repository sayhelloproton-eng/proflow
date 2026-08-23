# execution-browser-extension Setup

## STEP-EXECUTION-BROWSER-EXTENSION-01 — 加载扩展并自动配对
Responsible: USER
Interactive executable: `pnpm exec -- proflow-execution-browser-extension setup`
Non-interactive executable: `pnpm exec -- proflow-execution-browser-extension setup`
Required inputs: none
Verify: `pnpm exec -- proflow-execution-browser-extension verify`
Success condition: 本地 pairing listener 已收到真实 Extension hello + heartbeat，并持久化部署证据。

运行命令后，ProFlow 会准备 unpacked 目录、复制路径并打开 Chrome 扩展管理页。用户唯一必须完成的动作是启用开发者模式并选择“加载已解压的扩展程序”。扩展身份发现、Bridge 配置和 heartbeat 验证均自动完成，不需要复制标识，也不接受人工声明后台正在运行。

## STEP-EXECUTION-BROWSER-EXTENSION-02 — 验证部署状态
Responsible: AI
Interactive executable: `pnpm exec -- proflow-execution-browser-extension verify`
Non-interactive executable: `pnpm exec -- proflow-execution-browser-extension verify`
Required inputs: none
Verify: `pnpm exec -- proflow-execution-browser-extension verify`
Success condition: `execution-browser-extension.setupStatus=READY`.

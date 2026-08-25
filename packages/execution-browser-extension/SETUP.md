# execution-browser-extension Setup

## STEP-EXECUTION-BROWSER-EXTENSION-01 — 加载扩展并自动配对
Responsible: USER
Interactive executable: `pnpm exec -- proflow-execution-browser-extension setup`
Non-interactive executable: `pnpm exec -- proflow-execution-browser-extension setup`
Required inputs: none
Verify: `pnpm exec -- proflow-execution-browser-extension verify`
Success condition: 本地 pairing listener 已收到真实 Extension hello + heartbeat，并持久化部署证据。

运行命令后，ProFlow 会先准备 unpacked 目录和所有机器配置，把正确目录复制到剪贴板，自动打开 `chrome://extensions/`，并开始等待扩展连接。用户只需要在 Chrome 中完成一次安装确认：如果开发者模式尚未开启则先开启，然后点击“加载未打包的扩展程序”，在目录选择窗口中粘贴并确认刚刚复制的目录。完成后无需回终端输入任何内容；扩展身份确认、Bridge 配置、hello/heartbeat 验证和 READY 状态均由 ProFlow 自动完成。

## STEP-EXECUTION-BROWSER-EXTENSION-02 — 验证部署状态
Responsible: AI
Interactive executable: `pnpm exec -- proflow-execution-browser-extension verify`
Non-interactive executable: `pnpm exec -- proflow-execution-browser-extension verify`
Required inputs: none
Verify: `pnpm exec -- proflow-execution-browser-extension verify`
Success condition: `execution-browser-extension.setupStatus=READY`.

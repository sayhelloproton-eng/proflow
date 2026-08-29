# execution-browser-extension Setup

## STEP-EXECUTION-BROWSER-EXTENSION-01 — 加载扩展并自动配对
Responsible: USER
Interactive executable: `platform setup`
Non-interactive lifecycle entry: `platform setup`
Required inputs: none
Verify: `platform status`
Success condition: 本地 pairing listener 已收到真实 Extension hello + heartbeat，并持久化部署证据。

运行命令后，ProFlow 会先准备 unpacked 目录和所有机器配置，并尝试用真实 hello + heartbeat 重验证已有扩展。若已有扩展仍在线，则无需任何人工操作，setup 直接继续；只有未检测到在线扩展时，ProFlow 才把正确目录复制到剪贴板、打开 `chrome://extensions/` 并提示用户完成安装操作：如果开发者模式尚未开启则先开启，然后点击“加载未打包的扩展程序”，在目录选择窗口中粘贴并确认刚刚复制的目录。完成后无需回终端输入任何内容；扩展身份确认、Bridge 配置、hello/heartbeat 验证和 READY 状态均由 ProFlow 自动完成。历史 `setup.json` / verification evidence 不能单独跳过本次 live revalidation。

若等待超时，已经准备好的扩展文件和机器配置会保留，且不会写入伪 READY evidence。用户只需确认 Chrome 中已经完成扩展加载，然后重新执行 `platform setup`；稳定错误代码为 `PAIRING_TIMEOUT`。

## STEP-EXECUTION-BROWSER-EXTENSION-02 — 验证部署状态
Responsible: AI
Interactive executable: `platform status`
Non-interactive executable: `platform status`
Required inputs: none
Verify: `platform status`
Success condition: `execution-browser-extension.setupStatus=READY`.

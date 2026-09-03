# Runbook｜Execution Browser Extension

> Owner：`@tomflow/proflow-execution-browser-extension`。Deployment、Real-3、后续 Browser Journey 共用本文。

## 用户/产品路径

Browser setup 必须走真实 Chrome 扩展 UI / 产品 pairing，不允许直接写 pairing evidence、Extension ID 或 `.proflow` 配置。

正常路径：

```text
platform setup
→ 开发者模式
→ Load unpacked 真实 materialization
→ pairing token/config
→ extension heartbeat
→ Platform 观察 READY
```

Fresh/旧 session 恢复的已验证人工路径：`Remove → 系统确认 → Load unpacked`。只有真实状态证明旧扩展失效/陈旧时才走恢复；READY 后不要每轮重复 Remove/Load。

## Human-E2E harness

稳定资产：`scripts/human-e2e/browser-extension-ui.mjs` + `scripts/human-e2e/browser-extension-ui.swift` + `scripts/human-e2e/platform-setup.exp`。已有 canonical helper 时禁止再写 `/tmp/*.swift`、临时 expect、固定坐标或第二套浏览器安装流程。

- helper 编译必须在 pairing 临界区外 `--compile-only` 预热。
- 2026-09-02 首次编译曾 187s，直接超过 pairing 120s；预热后 UI 扫描降到秒级。
- 只扫描当前 Chrome focused window，避免全局 AX 扫描变慢。
- install 入口先清理遗留系统文件选择器/“前往文件夹”面板，再操作当前 UI。

## 焦点与系统 UI

Browser AX 临界区内禁止 Playwright/ChatGPT/Terminal 抢前台。稳定模式是同一原子操作里 `activate Chrome → locate current AX bounds → click/type → verify`；不要写死截图坐标。

系统“前往文件夹”/目录选择器应按真实面板/按钮识别，不以“文本框数量增加”这类脆弱启发式判断。

Playwright 主要负责观察真实 Browser 页面、业务 Chat、结构证据；AX helper 负责 `chrome://extensions` 和系统文件选择器。两者不要同时争抢焦点。

必须区分 **Playwright MCP Extension（测试基础设施）** 与 **ProFlow Execution Browser Extension（产品）**。Playwright 的 `connect.html`、调试 banner、relay token 都不属于 ProFlow 产品状态；出现连接页时按 `基础动作/Tool-Runtime-gptweb-mcp.md` 恢复工具链，禁止把它误判成产品扩展未连接或 Dev Tunnel 登录页。

## 真提交语义

Real-3 Browser submit 的成功不是 Extension API 返回 `ok`。必须在真实 ChatGPT 页面结构中确认对应 user message 已出现。

当前实现的关键结构证明使用 `[data-message-author-role="user"]`；无法确认时必须 fail closed：`MESSAGE_SUBMIT_REALITY_UNCONFIRMED`。具体发布版本属于 CURRENT/历史，不固化在本 Runbook。

严格区分：

```text
submit API success != 用户消息真实出现
WAKE success       != Node success
```

## 修复/更新

若 repo/Registry/Workspace materialization 版本不一致，先恢复版本真值，再走 `流程/Package-Update-Loop.md`。禁止 repo 直接复制 extension 源码到 Product Workspace、禁止改 node_modules 代替 `platform update`。

真实 Browser 已 READY 时，后续流程直接从业务 checkpoint 继续，不为“保险”重复 Browser setup。

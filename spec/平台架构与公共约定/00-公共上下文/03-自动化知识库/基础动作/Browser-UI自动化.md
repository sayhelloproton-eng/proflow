# Primitive｜Browser / System UI 自动化

> 目标：站在真人视角自动化真实 Chrome 与系统 UI，不通过内部注入制造成功。

## 工具分工

- Playwright Chrome：真实 Web 页面、Tab、登录/授权页面、ChatGPT Conversation、DOM/网络/截图证据。
- macOS AX/Swift helper：`chrome://extensions`、开发者模式、Load unpacked、系统文件选择器等 Playwright 无法直接覆盖的 UI。
- Local Dev：启动 harness、读取日志/PID、验证本机文件和产品输出。

涉及 Playwright 前先读 `Tool-Runtime-gptweb-mcp.md`。当前实测连接模型是：同步 Extension 当前 token → 写入 `playwright-chrome.env` → `gptweb-mcp restart` → runtime ready → 首次调用 Playwright。此时允许出现一个 `connect.html`，但它应自动显示 `“Playwright MCP” connected.`；这是 relay/client bootstrap 成功态，不是失败。

Playwright 只控制**受控标签组**中的页面，不会自动看到用户 Chrome 的所有普通 Tab。首次 `browser_tabs` 可能只有 connected 页面；通过 `browser_tabs new <url>` 新建受控业务页后，已经真实验证 tabs/snapshot/screenshot/navigation/多 Tab 切换和短暂停后的连接复用均可工作。已有普通 Tab 若需要控制，应先加入 Playwright 受控组。

真实 Browser authority 是：目标业务页出现在 `browser_tabs`，并且 snapshot/screenshot 能读取其真实内容。达到后固定节奏是：**浏览器动作 → 立即 snapshot/screenshot 观察 → authority 回读 → 下一步**，让 Playwright 作为每一步的“眼睛”。

当前实测还有一个独立输入限制：`browser_click` 在两个不同普通 Web 页面上都出现 `locator 已解析 → waiting for element visible/enabled/stable → 5s timeout`；这时连接、tabs、snapshot、screenshot 都仍正常。不要把它误判为断线。键盘输入链已真实验证可用：`Shift+Tab` 能把焦点移动到目标按钮，截图可看到 focus ring，随后 `Enter` 能真实提交表单并跳转结果页。遇到同类 click actionability timeout 时，若键盘操作语义等价，优先使用真实键盘路径并截图确认；系统 UI 仍按 AX/Swift 边界处理。

如果当前 Playwright Extension token 需要同步到本机 wrapper，不自行猜值、不从历史复用旧值。按 `Tool-Runtime-gptweb-mcp.md` 的 **Playwright Extension Token 更新 SOP**：从 Extension 当前 connect/status 页面复制整行 `PLAYWRIGHT_MCP_EXTENSION_TOKEN=...`，写入 `/Users/agent/.config/openai/tunnel-client/playwright-chrome.env`；token 明文不得落库。更新完成后必须重新跑 Browser 连接验收，验证通过才恢复 Playwright 自动化。

## 焦点纪律

系统 UI 临界区内只允许一个控制者。固定模式：`activate Chrome → locate current bounds → act → verify` 尽量一个原子 helper 内完成。

不要在 AX helper 正操作扩展页/系统选择器时调用 Playwright 抢前台；也不要让 Terminal/ChatGPT 成为焦点。禁止写死一次截图的坐标。

## 性能

编译型 helper 在产品 timeout 之外预热。编译和真实 UI mutation 分离；prewarm 不能顺便点击/安装/卸载。

失败后优先从当前可见 UI checkpoint 恢复，不关闭 Chrome、重启整条 setup 或重新登录，除非真实状态证明必须这样做。

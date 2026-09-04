# Primitive｜Browser / System UI 自动化

> 目标：站在真人视角自动化真实 Chrome 与系统 UI，不通过内部注入制造成功。

## 工具分工

- Playwright Chrome：真实 Web 页面、Tab、登录/授权页面、ChatGPT Conversation，以及**能够被 Playwright debugger attach 的页面**；负责 DOM/网络/page screenshot 证据，这些普通页面默认后台执行，不抢用户前台焦点。
- macOS AX/Swift helper + 系统截图：处理 Chrome privileged UI，以及 **Playwright 无法 debugger attach、但真人仍然可见可操作的页面**。典型包括 `chrome://extensions`、扩展工具栏菜单、开发者模式、Load unpacked、系统文件选择器，以及另一个扩展的 `chrome-extension://...` 页面。此时 AX/截图仍可承担“眼睛 + 手”：识别可见 UI、截图分析、诊断、点击和可见状态确认。
- Local Dev：启动 harness、读取日志/PID、验证本机文件和产品输出。

**能被 Playwright debugger attach 的普通 Task/Web 页面禁止退回 AX。** 其点击、输入、状态读取和截图必须回 Playwright；AX helper 遇到 `create-real3-task / recover-real3-workers` 等旧普通页面动作应 fail-fast。唯一例外是页面本身属于 Chrome/Extension 安全边界、Playwright 已被机械证明无法 attach（例如另一个扩展的 `chrome-extension://...` 页面）；这时 AX/系统截图可以继续作为真人视角自动化，不得把“Playwright 不可调试”误判成“页面不可观察/不可诊断/不可点击”。

涉及 Playwright 前先读 `Tool-Runtime-gptweb-mcp.md`。当前实测连接模型是：同步 Extension 当前 token → 写入 `playwright-chrome.env` → `gptweb-mcp restart` → runtime ready → 首次调用 Playwright。此时允许出现一个 `connect.html`，但它应自动显示 `“Playwright MCP” connected.`；这是 relay/client bootstrap 成功态，不是失败。

Playwright 只控制**受控标签组**中的页面，不会自动看到用户 Chrome 的所有普通 Tab。首次 `browser_tabs` 可能只有 connected 页面；通过 `browser_tabs new <url>` 新建受控业务页后，已经真实验证 tabs/snapshot/screenshot/navigation/多 Tab 切换和短暂停后的连接复用均可工作。已有普通 Tab 若需要控制，应先加入 Playwright 受控组。

**Real-3 固定 Browser 工作集**：同一个 Playwright controlled group 中保持 `ProFlow Tasks + Product Worker Conversation + Dev Worker Conversation + Test/Ops Worker Conversation`。三个 `/g/<gid>` Role 根页不属于运行工作集；真正纳管的是 `worker.create` 产生的原始 `/g/<gid>/c/<workerRef>` Conversation Tab。Conversation 创建后应把**原 Tab**加入当前 Playwright group，禁止为了测试再开第二份同 URL Tab，避免 Browser Carrier 对同一 Worker 出现多 Tab 歧义。

真实 Browser authority 分两条：**Playwright 可 attach 页面**要求目标业务页出现在 `browser_tabs`，且 snapshot/page screenshot 能读取真实内容；**Playwright 不可 attach 但真人可见页面**则用 AX tree + 系统截图证明真实 UI，再由截图视觉分析/AX 元素执行诊断与点击。后者仍然是有效的真人视角 evidence，只是没有 DOM/Network authority。两条路径都固定遵守：**动作 → 立即视觉/结构观察 → Owner authority 回读 → 下一步**。

当前实测还有一个独立输入限制：`browser_click` 在两个不同普通 Web 页面上都出现 `locator 已解析 → waiting for element visible/enabled/stable → 5s timeout`；这时连接、tabs、snapshot、screenshot 都仍正常。不要把它误判为断线。键盘输入链已真实验证可用：`Shift+Tab` 能把焦点移动到目标按钮，截图可看到 focus ring，随后 `Enter` 能真实提交表单并跳转结果页。遇到同类 click actionability timeout 时，若键盘操作语义等价，优先使用真实键盘路径并截图确认；系统 UI 仍按 AX/Swift 边界处理。

如果当前 Playwright Extension token 需要同步到本机 wrapper，不自行猜值、不从历史复用旧值。按 `Tool-Runtime-gptweb-mcp.md` 的 **Playwright Extension Token 更新 SOP**：从 Extension 当前 connect/status 页面复制整行 `PLAYWRIGHT_MCP_EXTENSION_TOKEN=...`，写入 `/Users/agent/.config/openai/tunnel-client/playwright-chrome.env`；token 明文不得落库。更新完成后必须重新跑 Browser 连接验收，验证通过才恢复 Playwright 自动化。

## 焦点纪律

**用户前台焦点属于用户。默认自动化不得 `activate Chrome`、不得移动真实鼠标/键盘、不得截整个桌面。** 普通 ChatGPT / ProFlow Tasks / Web 页面固定用 Playwright 在受控 Tab 内后台动作、DOM readback 与 page screenshot。

只有 Chrome privileged UI 临界区允许短暂激活 Chrome，例如：扩展工具栏菜单、`chrome://extensions`、Load unpacked、系统 picker、Chrome 原生确认框。此时固定模式为 `activate Chrome → locate current bounds → act → verify → 立即退出 privileged 临界区`，尽量一个原子 helper 内完成，不把激活状态带入后续普通页面步骤。

不要在 AX helper 正操作 privileged UI/系统选择器时调用 Playwright 抢前台；也不要让 Terminal/ChatGPT 成为焦点。禁止写死一次截图的坐标。普通页面失败时使用 Playwright page screenshot；只有 privileged UI 失败才允许系统级截图。

## 版本与现实回读

Extension package / materialization / `platform setup` READY 不能替代 Chrome 已加载 runtime 的版本事实。更新 unpacked Extension 后至少做两层 readback：① `chrome://extensions` 可见版本/ID；②真实 action 行为或 Extension Page 内容。两者不一致时，以真实 runtime 行为为准。

同一路径物化已更新但 Chrome 仍执行旧 manifest/action 时，不要连续盲点 Reload。先恢复注册 path authority；若 path 正确而 runtime 仍旧，按 canonical `Remove → Load unpacked → pairing` 恢复，再确认版本与 Extension ID。AX selector 必须兼容中英文并读取 title/value/description/help 的组合文本，不依赖单一 AXTitle，更不写死坐标。

## 性能

编译型 helper 在产品 timeout 之外预热。编译和真实 UI mutation 分离；prewarm 不能顺便点击/安装/卸载。普通页面的 snapshot/screenshot 与交互应尽量在一次 Playwright 受控 Tab 会话内完成，避免 AX ↔ Playwright 来回切换。

失败后优先从当前可见 UI checkpoint 恢复，不关闭 Chrome、重启整条 setup 或重新登录，除非真实状态证明必须这样做。

## 2026-09-03｜Real-3 Tasks / Playwright 受控组补充经验

- `chrome-extension://` 页面被 Chrome 跨扩展 debugger 安全边界拒绝时，只代表 Playwright 无法 attach；AX tree + 系统截图仍可作为真人“眼睛和手”做观察、诊断、点击。不可把“不可调试”误判成“不可自动化”。
- `ProFlow Tasks` 主路径迁移为 owning package 自己的 loopback Web surface 后，必须纳管 **Extension action 打开的原始 Tasks Tab**；禁止额外复制一个 `/tasks` Tab 再交给 Playwright，否则会造成 session / tab identity 污染。
- Playwright controlled group 的 Real-3 固定工作集是：`ProFlow Tasks + Product/Dev/Test-Ops 三个真实 Worker Conversation`。Conversation 也必须纳管原创建 Tab，不复制第二份。
- **Playwright controlled group 是运行态，不是持久化 Owner truth。** Chrome / Playwright Extension / gptweb-mcp / 平台重启后，受控组可能消失，即使真实业务 Tab 仍然存在。此时固定恢复顺序是：① 先用无焦点 Browser/本机现实确认原始 `ProFlow Tasks` 与 Worker Conversation Tab 仍存在；② 重新建立 Playwright connection；③ 把这些**原始 Tab**重新加入同一个 controlled group；④ 用 `browser_tabs + snapshot/page screenshot` 重新证明控制权；⑤ 然后从原 checkpoint 继续。禁止因为 `browser_tabs` 只剩 `connect.html` 就误判产品页面丢失、重新创建 Task/Conversation、重跑 setup 或复制第二份业务 Tab。
- Extension action 每次都必须真实执行 session mint / bootstrap；Human-E2E helper 不得因为“Tasks 页面已经可见”就提前 return。页面存在只能证明 UI reality，不能证明本次 action 已执行。
- Harness 成功判据不得只写“目标页存在”。对于带恢复语义的 privileged action，必须证明动作本身被触发，并在普通页面阶段立即切回 Playwright 做 DOM/Owner readback。
- loopback Web session 的 cookie scope 必须与所有受保护资源路径一致；本次 `/tasks.js` 不匹配 `Path=/tasks` 的缺陷通过把脚本收敛到 `/tasks/app.js` 修复，而不是放宽 cookie 到 `/`。

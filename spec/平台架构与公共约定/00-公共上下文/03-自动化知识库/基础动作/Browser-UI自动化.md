# Primitive｜Browser / System UI 自动化

> 目标：站在真人视角自动化真实 Chrome 与系统 UI，不通过内部注入制造成功。

## Reality-first 硬门

Browser/UI 失败的第一任务是回答“用户此刻真正看到了什么”，不是解释源码“应该发生什么”。固定优先级：

```text
普通 Web / ChatGPT / Tasks
→ Playwright current URL + page screenshot + snapshot/DOM

chrome:// / Extension errors / toolbar / 系统 picker / 原生确认
→ AX tree + privileged screenshot

拿到 fresh reality
→ Owner/runtime readback
→ 现实证据确实指向实现后，才进入 Repomix/CodeGraph/Local Dev
→ 修复后回原页面 SAME SCENE 复验
```

**截图就是眼睛，不是附加证明。**出现 Error、Permission、Unexpected Page、Loading、按钮状态异常等 UI symptom 时，在当前页面证据缺失的情况下禁止 source-first diagnosis。Playwright 不能 debugger attach 某个 privileged 页面，只代表控制边界变化，不代表页面不可由 AX/screenshot 观察。

### Browser Side Effect / Identity 异常快速路径

凡是 `UNKNOWN_SIDE_EFFECT`、消息出现在错误 Conversation、OPEN/NAVIGATE 后页面身份异常、submit 结果与 Owner 不一致，第一轮一次采齐相关页面，而不是逐页猜源码：

```text
1. page screenshot（相关 Product / Dev / Test 等页面一次采齐）
2. current URL + snapshot/DOM；privileged 页面用 AX tree
3. Owner truth：请求的 role/worker/conversation 是谁
4. Execution truth：实际 effect / precondition / UNKNOWN 在哪一步
5. 建立 Owner / Browser / Execution 三方矩阵，找第一处分叉
6. 三方首次不一致立即 STOP 新 mutation / Recover / Submit
7. 现实已把范围指向 owning package 后，才进入 Repomix / CodeGraph / Local Dev
```

截图必须属于**第一批 evidence**，不得在源码分析结束后补拍来替代事故现场。动作仍遵守 `OBSERVE → one mutation → OBSERVE`；跨多个固定 Worker 的异常应优先批量观察同一 controlled group，避免边查一个边改变另一个。

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

### Privileged UI 一次前台原子回合

当 Playwright 已机械证明不能直接 attach `chrome://` / `chrome-extension://` 页面时，**不要继续把“找到更程序化的控制方式”当目标**。如果真人只需要看一眼并点一次，自动化也必须保持同样低心智：

```text
一次切 Chrome 前台
→ 一张 fresh privileged screenshot，确认当前页面、目标卡片/按钮和当前版本
→ 只做一次必要 mutation（Reload / Load unpacked / Confirm 等）
→ 立即再截一张 screenshot，确认可见结果
→ 立刻退出前台临界区
→ 后台用 platform / Owner / heartbeat / Registry 等 authority 证明业务状态
```

- 一张截图已经足够定位目标时，禁止继续尝试 Playwright privileged navigation、extension-origin navigation、AppleScript JS、AX 菜单探测等第二/第三条路线。
- 不能为了“更自动化”反复 activate Chrome、切 Tab、开 privileged page、抢焦点；这属于**执行方式错误**，不是产品 defect。
- Chrome Extension Manager 的卡片位置不是 identity。新增/删除其它扩展会让卡片从第二格、第三格等位置漂移；helper 禁止按列号、DOM/AX 全局顺序或“目标名称之后第一个 Reload/Remove”定位 mutation。**Extension ID + 名称只用于确认目标身份，不得把“包含 ID/名称的最小 AX ancestor”当作稳定卡片边界。** Chrome AX tree 可能把相邻卡片折叠进同一祖先，导致跨卡片命中错误 action。真正 mutation 前必须在当前 fresh screenshot/AX reality 中独立验证动作与目标身份的几何/可见关系；Reload/Remove selector 必须经过当前 Chrome 版本 fresh validation。Remove 等 destructive action 还必须在 Chrome 原生确认框中再次核对目标名称/身份，不一致立即 STOP。
- privileged mutation 的“命令返回成功 / AXPress 返回成功 / AppleScript 返回成功”都不能替代动作后的截图；截图是视觉真值，Owner/heartbeat 是业务真值。
- 若第一次 screenshot 发现页面不对，先纠正到正确页面后再开始原子回合；错误页面截图不能拿来推断目标按钮坐标。

不要在 AX helper 正操作 privileged UI/系统选择器时调用 Playwright 抢前台；也不要让 Terminal/ChatGPT 成为焦点。禁止写死一次截图的坐标。普通页面失败时使用 Playwright page screenshot；只有 privileged UI 失败才允许系统级截图。

## 版本与现实回读

Extension package / materialization / `platform setup` READY 不能替代 Chrome 已加载 runtime 的版本事实。更新 unpacked Extension 后至少做两层 readback：① `chrome://extensions` 可见版本/ID；②真实 action 行为或 Extension Page 内容。两者不一致时，以真实 runtime 行为为准。

同一路径物化已更新但 Chrome 仍执行旧 manifest/action 时，不要连续盲点 Reload。先恢复注册 path authority；若 path 正确而 runtime 仍旧，按 canonical `Remove → Load unpacked → pairing` 恢复，再确认版本与 Extension ID。AX selector 必须兼容中英文并读取 title/value/description/help 的组合文本，不依赖单一 AXTitle，更不写死坐标。

## Chrome Extension 错误页 SOP

`chrome://extensions` 卡片出现“错误”时，不得停在卡片级结论，也不得直接把它解释成当前 Service Worker root cause。必须进入该扩展的错误详情页：`chrome://extensions/?errors=<extensionId>`，读取错误标题、上下文、stack/source preview，并用 privileged UI 截图留证。

Chrome 会保留历史 Extension error。错误列表中的旧 `SyntaxError` 不等于当前已加载版本仍然复现同一错误。固定判别流程：① 记录当前版本/ID；② 读取错误详情；③ 对比当前 materialized artifact；④ 清空错误记录；⑤ reload 当前 Extension；⑥ reload/刷新最小业务页触发 content injection；⑦ 再回错误页只看 fresh errors。只有重新产生的 error 才能作为当前版本 runtime root cause。

对于 manifest `content_scripts`，Chrome 按 classic script 执行；当前产物必须是自包含 IIFE/classic bundle，不得残留顶层 `import/export`。若错误页报 `Cannot use import statement outside a module`，先机械读取当前 `dist/extension/content.js` 与 materialized copy；源码预览已是 `"use strict"; (() => { ... })` 且 residual ESM=0 时，应优先判定为历史 error 待 fresh reproduction，而不是再次修改 build pipeline。

**截图就是浏览器现实的眼睛。** 对 `chrome://extensions` / errors 这类 privileged 页面，每次关键动作都使用 AX tree + 系统/privileged screenshot 双证据；不要只靠 CLI、Extension helper 返回值或历史 error badge 推断用户当前看到的状态。

## Browser Runtime 故障定位路径

遇到“扩展看起来加载成功，但 setup / pairing / runtime 仍失败”时，固定按**现实分层 → fresh reproduction → 请求链定位 → owning root cause**推进，不先改代码：

1. **先区分历史错误与当前错误。** 记录 Extension 版本/ID，清空 Chrome 历史 errors，reload Extension，再刷新一个最小业务页触发真实 content injection；只把随后重新出现的 fresh error 当作当前版本证据。
2. **视觉事实与协议事实分开取证。** `chrome://extensions` / errors 用 AX + screenshot 证明“浏览器当前实际看到什么”；普通业务页用 Playwright snapshot/page screenshot；本机 listener、PID、materialized config 用 Local Dev。任何一层都不能代替另一层。
3. **先证明 runtime 有没有活着，再证明它走到哪一步。** Extension 能持续发请求，说明 Service Worker / retry loop 在运行；不要把“请求失败”误判成“Background 没启动”。随后只记录安全的 `METHOD + PATH + STATUS` 请求时间线，不记录 token/header/body。
4. **按第一处分叉定位，而不是追最后一个报错。** 例如 `hello → 200 → carrier/attentions → 404 → hello 重来` 已经足以证明断点在第二个协议调用；后续 `PAIRING_TIMEOUT` 只是最终症状，不能当根因。
5. **区分原始根因与停止诊断后的后续现象。** 若诊断结束后主动停止临时 server，Extension 继续 retry 产生的 `ERR_CONNECTION_REFUSED` 只说明当前端口无人监听，不得倒推成原始 pairing root cause。
6. **真实请求序列优先于静态猜测。** 先用运行时序列收敛到具体 endpoint/阶段，再回源码确认 caller、server route 和成功条件；禁止从一个错误字符串直接跳到 build、Chrome、网络或权限层大修。
7. **先 RED，再最小修复。** 把真实失败顺序写成组合回归约束，要求修复只扩 owning boundary 的兼容面，不放宽认证、不改变 readiness/pairing 真值；RED 精确命中后才改实现。
8. **修复后回到同一真人路径复验。** targeted test/typecheck 通过仍不等于 Browser reality；必须再跑同类真实 setup，并证明请求链越过原断点进入后续 poll/heartbeat/readiness。

这套路径的核心不是“多收集日志”，而是尽快找到**第一条与协议预期不一致的真实边**。一旦第一处分叉已被运行时证据证明，就停止无关方向探索。

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

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

## Runtime Content Script / 错误页判别

manifest `content_scripts` 是 classic script。`dist/extension/content.js` 必须是自包含 classic/IIFE bundle，不能残留顶层 ESM `import/export`；`provisioning-content.js` 也遵守相同原则。build/publishability 通过后，真实 Workspace 仍要对 repo build、`node_modules`、`.proflow/deployment` 三份产物做 hash/readback，避免拿源码候选代替用户现实。

Chrome Extension Manager 的“错误”徽标会保留历史记录。看到 `Cannot use import statement outside a module` 时，必须进入 `chrome://extensions/?errors=<extensionId>` 看详情，再与当前 materialized `content.js` 对照；若当前文件已经是 `"use strict"; (() => { ... })` 且无 residual import，先执行“清空错误 → reload Extension → reload 最小 GPT 页 → 回错误页看 fresh error”，不要把旧错误继续当当前 runtime root cause。

Extension pairing/readiness 失败时，错误详情页是 privileged Browser reality 的必要诊断入口。卡片只显示“错误”不足以定位根因；AX tree + 系统截图负责此处的视觉/结构证据，普通 GPT 页再交回 Playwright snapshot/page screenshot。

## OPEN / Page Identity / Side Effect 不变量

Browser Carrier 不得把定位器或缓存事实冒充页面身份：

```text
tabId 相同 != 页面相同 != content session 相同 != role/worker identity 相同
OPEN 返回 != OPEN 已被真实页面证明
```

`OPEN` 成功至少要求：本次操作之后产生的 fresh observation、当前 content session、请求目标对应的 canonical role/worker identity。Background 的 session cache 只能作为观察缓存，不能仅凭 `sessions.get(tabId)` 越过 fresh/identity proof；Tab/Navigation 生命周期产生的 stale observation 必须 fail closed。

`worker.create` 等会向真实 ChatGPT 产生外部写入的能力，顺序必须是：

```text
OPEN target
→ fresh observation
→ canonical identity == requested identity
→ durable EFFECT_STARTED
→ SUBMIT
→ hasMessage reality verification
→ bind Owner truth
```

如果 OPEN 实际落到其它 Role/Worker，必须在 durable effect boundary 前失败，保证 `submit = 0`；禁止先发送 `WORKER_BIND`，再用 `CREATE_REALITY_UNCONFIRMED` 发现错页。

ChatGPT 的 Custom GPT Conversation URL 可能在 canonical GPT id 后追加 display slug。Browser reconciliation 必须先恢复持久化的 canonical roleRef，再与 Task/Role Owner truth 比较；不能把整个 slugged path segment 当成新的 role identity。具体 URL 解析实现属于代码，不把偶然 slug 文本固化成合同。

## Pairing / Runtime Bridge 协议漂移定位

`platform setup` 的临时 pairing server 与正常 Browser Reality Bridge 不是同一个运行阶段，但 Extension Background 会复用同一套启动协议。因此 Background 新增启动期强制请求时，**正常 Runtime Bridge 已支持 ≠ pairing server 自动支持**；两边协议面必须一起审计。

遇到 `PAIRING_TIMEOUT` 时不要直接重跑 setup，也不要先怀疑 Chrome/网络。固定先恢复以下真实请求链：

```text
POST /v1/session/hello
→ 启动期附加 publish（例如 /v1/carrier/attentions）
→ GET /v1/commands/next
→ POST /v1/session/heartbeat
```

只记录 `METHOD + PATH + STATUS`，不得记录 Authorization、token、request body。定位时看**第一个与预期不一致的状态码**：

```text
hello 200
→ carrier/attentions 404
→ Background catch / retry
→ hello 200
→ carrier/attentions 404
```

这类序列已经可以证明：Extension Background 活着、runtime config/endpoint/token 至少足以完成 hello，真正断点是 pairing server 缺少启动协议路由；因为 loop 在 publish 处重启，所以后续 poll/heartbeat 根本不会发生，最终 `PAIRING_TIMEOUT` 只是派生症状。

必须同时保留 pairing 真值边界：

```text
hello      != paired
attention  != paired
poll       != paired
heartbeat   = paired
```

因此修复 pairing compatibility 时，只允许补齐真实 Background 在 pairing 阶段必须经过的安全兼容路由；不得为了让 setup 通过而把 `hello`、attention 或 poll 改成 READY/paired 证据，也不得放宽 origin / bearer / extensionInstanceId 校验。

测试要求不能只覆盖“人工拼出来的旧握手”。至少要有一条组合约束模拟当前真实 Background 启动顺序：`hello → attention publish → first poll → heartbeat`。若 Background 协议以后再新增启动期强制调用，这条组合测试必须同步更新，否则单测全绿仍可能出现真实 Chrome pairing regression。

诊断结束后若主动停止临时 pairing server，DevTools 中后续持续出现的 `hello → ERR_CONNECTION_REFUSED` 只表示 47080 当前无人监听；这是 retry loop 的后续现象，不能反向覆盖之前已经捕获的原始 `200 → 404` 根因序列。

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

# Primitive｜ChatGPT 本机工具运行时 / gptweb-mcp

> 目标：让新 Chat 直接复用已经建立的 Repomix / CodeGraph / Local Dev / Playwright Chrome 四类工程能力，不重新连接、重装、猜 transport，也不因单个工具新增/发现而无必要重启共享 runtime。

## 统一入口与真源

本机工程能力统一由 `/Users/agent/.local/bin/gptweb-mcp` 管理：

```text
repomix
codegraph
local-dev
playwright-chrome
```

日常生命周期只使用：`gptweb-mcp start | status | test | stop | restart`。当前健康目标是 `REPOMIX=READY / CODEGRAPH=READY / LOCAL_DEV=READY / PLAYWRIGHT_CHROME=READY / GPTWEB_MCP=4/4_READY`。

`gptweb-mcp` 是多个 Chat 可能共享的本机运行时。**`restart/stop` 属于共享破坏性动作**：已有其它会话在使用时禁止为了“刷新插件”“重新发现工具”或普通诊断直接全量重启；先用当前 Chat 的工具发现/真实调用验证。只有 runtime 真实异常、配置必须重新加载，且已确认不会打断其它工作或得到用户明确授权时才重启。

单项异常时先查询对应 `tunnel-client runtimes status <alias> --json`，不要先重装插件、重建 Tunnel 或重启全部环境。易变化的 Tunnel ID、runtime command、profile 以 `gptweb-mcp` 与 `~/.config/tunnel-client/` 当前配置为真源，不复制第二份；任何 token/relay credential 都不得输出或落库。

## 常驻守护与幂等

`gptweb-mcp start` 的自动守护**只能**由唯一主 LaunchAgent `com.sayhello.gptweb-mcp` 承担。任何 Chat、排障脚本、权限修复、restart/test Harness 都不得再创建第二个 `gptweb-mcp-*` LaunchAgent、KeepAlive job、StartInterval job 或其它“私家 manager”。临时诊断只能以前台/当前命令的一次性动作执行；需要显式 restart 时只调用唯一入口 `gptweb-mcp restart`，不得再包一层后台 supervisor。

固定不变量：

```text
launchctl manager count = 1
manager label            = com.sayhello.gptweb-mcp
manager entry            = /Users/agent/.local/bin/gptweb-mcp start
managed runtime count    = local-dev/codegraph/repomix/playwright-chrome 各 1
```

2026-09-03 的真实事故就是违反该不变量：排障过程中额外创建 `permission-restart / final-repair / clean-once` 等临时 manager，它们与正式 60 秒 watchdog 并发执行 `start/restart/stop/cleanup`，共同写 `aliases.yaml/processes.yaml`，使 Repomix 等 runtime 在真实 MCP 请求中被 `context canceled`，表面表现成 pack/grep timeout。**根因不是 Repomix 打包慢，而是多 manager 互相干扰。**以后遇到 runtime 抖动、PID 变化、health URL 消失、`aliases.yaml.tmp rename` 冲突时，第一检查项固定是 `launchctl list | grep gptweb-mcp`；若多于唯一主 manager，先删除额外 manager，再讨论 MCP 本体。

守护判断继续使用本地 `~/Library/Application Support/tunnel-client/health/<alias>.url` + `/readyz`，不得把依赖 OpenAI control plane 的 `tunnel-client runtimes status` 作为每分钟 liveness 真源。幂等验收至少包含：`launchctl` 只剩唯一 manager；四个 runtime 各 1；`gptweb-mcp test` 为 `4/4_READY`；显式 `restart` 后恢复 `1/1/1/1`；跨至少一个完整 60 秒 watchdog 周期后四个 managed PID 完全不变。历史重复 runtime 若可能被其它 Chat 使用，不得为了“清爽”直接批量 kill；先删除额外 manager、止住新增，再在明确维护窗口清理。

## Repomix Context Plane

当前 Repomix MCP 被限制在仓库根 `/Users/agent/Desktop/proton-workspace/repos` 的 sandbox 内；工具参数使用相对路径，例如 `proflow`、`job-search-system`，而不是绝对路径。稳定能力面是：

首次调用固定先做一次低成本 root preflight：`file_system_read_directory(".")`。当前预期只应看到 `proflow/`、`ai-agent-platform/`、`job-search-system/` 等 sandbox 内条目；随后整个 Chat 缓存该根语义。**不要传绝对路径，也不要再额外加一层 `repos/`**：`repos/proflow` 会被解析成 sandbox 下的 `repos/proflow` 而返回 `directory not found`。该错误首先按路径语义错误处理，不得直接归因到 Repomix runtime、不应因此跳过 Context Plane。

```text
file_system_read_directory / file_system_read_file
→ 小范围只读探索

pack_codebase
→ 把指定仓库/目录构造成稳定 outputId

grep_repomix_output
→ 在聚合上下文中快速定位主题、文件、heading、符号

read_repomix_output
→ 只读取命中附近的精确行段
```

高吞吐默认不是 `file_system_read_file × N`，也不是“任务一来先 pack 整个仓库”，而是**最小充分范围优先、证据驱动逐层扩张**：

```text
已知文件/符号
→ pack owning package / 最小相关目录
→ 围绕同一 outputId grep/read，批量建立实现、测试、配置和邻接上下文
→ 再进入 CodeGraph / Local Dev

未知但可定位到目录/包
→ pack 该 package / 最小相关目录
→ grep/read 判断信息是否足够

证据显示跨包/跨领域
→ 扩到父目录、相关 packages，或用 includePatterns 精确扩大

只有任务本身确实 repo-wide / 全局迁移 / 全仓一致性审计
→ 才 pack 整个仓库
```

每扩大一级都必须回答“当前不确定性为什么需要更大的范围”；不能因为 Repomix 能打全仓，就把全仓 pack 当默认入口。已有 `outputId` 时固定 `grep many → read small ranges`，禁止把百万 Token 输出整体灌入 Chat。工具本身是只读 Context Plane；任何当前源码修改、Git、测试和命令仍由 Local Dev 执行。任务路由细则见 `Chat-高吞吐本地工程执行.md`。

## Playwright Chrome 真实控制链

当前稳定链路是：

```text
ChatGPT → gptweb-mcp → tunnel-client
→ /Users/agent/.config/openai/tunnel-client/playwright-chrome-mcp.sh
→ Playwright MCP extension mode
→ 用户当前正在使用的真实 Chrome
```
它不是 Chrome for Testing 专用链路，也不应默认重启用户真实 Chrome；禁止回退到旧 `127.0.0.1:9229` CDP 路线。

## Playwright Extension 的真实连接模型

`chrome-extension://.../connect.html` 是 **Playwright MCP 每次建立新的 extension relay 时主动打开的连接选择页**。它不是 ProFlow 页面，也不是 Dev Tunnel GitHub Auth。`gptweb-mcp/tunnel-client READY` 只证明本机 tunnel/runtime 可接收 MCP 请求，不等价于“当前 MCP backend 已控制正确的业务 Tab”。

当前本机组合已机械确认：Playwright Extension `0.4.0` + `@playwright/mcp 0.0.80`。真实实测表明：同步正确 token 后，首次 Playwright 调用会打开 `connect.html`，并自动进入 `“Playwright MCP” connected.`。这个页面是 **Extension relay / MCP client 的 bootstrap 成功态**，不是连接失败，也不需要再次人工授权。

Playwright 只会看到当前 **受控标签组 / controlled context** 中的页面，不会自动枚举用户 Chrome 里所有未加入该组的普通 Tab。首次连接后 `browser_tabs` 可能只看到 `connect.html`；随后可通过 `browser_tabs new <url>` 创建受控业务页，或由用户把已有 Tab 加入 Playwright 受控组。只有进入受控组的页面才会出现在 `browser_tabs`，并可被 snapshot/screenshot/navigation 操作。

当前 Playwright Extension 的连接页本身明确给出“后续可把 Tab 拖入 Playwright group”的语义；**group membership 只是纳管第一层，不等于 debugger attach 已成功。** Real-3 不为每个页面建立独立 relay：固定复用同一 connection/group，把 `ProFlow Tasks` 与三个真实 Worker Conversation 原 Tab 纳入同组。对 Conversation 禁止复制打开同 URL 来“让 Playwright 看见”，否则会给产品 Browser Carrier 引入重复 Tab reality。

2026-09-03 已机械确认一个 Chrome 安全边界：Playwright MCP Extension 可以看到并把另一个扩展的 `chrome-extension://...` Tab 加入同一 group，`connectedTabIds` 也可能包含它，但真正执行 `chrome.debugger.attach` 时 Chrome 会拒绝，错误为 `Cannot access a chrome-extension:// URL of different extension`；browser-level CDP 同样可能返回 `Not allowed`。因此固定区分三层：① Tab 在 group；② Playwright debugger attach 成功并出现在 `browser_tabs/context.pages()`；③ 页面可由 snapshot/screenshot/DOM 操作。只有②③成立才算 Playwright 控制 READY。

所以固定判定层级是：

```text
gptweb-mcp / tunnel-client READY
→ transport/runtime READY

connect.html 显示 “Playwright MCP connected.”
→ Extension relay / MCP client 已连接

browser_tabs 中出现目标业务页
+ snapshot / screenshot 能读取该页
→ 业务 Browser 控制 READY
```

Chrome 顶部 debugger banner 只能证明 Extension 正在调试浏览器；最终业务 authority 仍以 `browser_tabs + snapshot/screenshot` 为准。

## tunnel-client 生命周期

本机 `tunnel-client 0.0.11` 日志已多次出现：`MCP connection TTL reached` → `stdio MCP command stdin write failed / file already closed` → runtime shutdown/restart。OpenAI tunnel-client #34 描述的就是同一 v0.0.11 shared-stdio deadline bug；上游新协议已改为非 initialize deadline 不得关闭共享 stdio child pipe。

因此“后续一次 Playwright tool call又打开 connect.html”还可能来自第二条链：**tunnel-client/runtime 退出 → stdio Playwright MCP 被重建 → 新 extension relay 按设计再次打开 connect.html**。单纯增加 `mcp.connection_max_ttl` 不能修复 response-deadline 导致 shared stdio 被关闭的问题。

如果后续再次出现新的 `connect.html`，先区分是正常首次 bootstrap，还是 tunnel-client/runtime 重建导致的新 relay；不要仅凭页面出现就判连接失败。禁止重启真实 Chrome、切旧 `9229` CDP 或重装扩展碰运气。

## Playwright Extension Token 更新 SOP

当需要同步 Playwright Extension 当前 token 到本机 MCP wrapper 时，固定使用下面路径：

```text
Playwright Extension connect.html / status.html
→ 找到当前 auth token 区域
→ 点击 `Copy to clipboard`
→ 将复制得到的整行
  `PLAYWRIGHT_MCP_EXTENSION_TOKEN=...`
  写入：
  /Users/agent/.config/openai/tunnel-client/playwright-chrome.env
→ 不在 Chat、日志、公共上下文或测试证据中打印 token 明文
→ 执行 `gptweb-mcp restart`，让 `playwright-chrome-mcp.sh` 重新读取 env
→ `gptweb-mcp status` 确认 `playwright-chrome` runtime ready
→ 再调用 Playwright；`connect.html` 自动进入 `“Playwright MCP” connected.` 表示 relay/client 连接成功
→ 继续用 tabs/snapshot/screenshot 验证业务 Tab 控制
```

安全约束：token 是运行时凭据，只存在于 Chrome Extension 存储、本机剪贴板和本机 env；**禁止落入仓库、历史 Round、截图文字转录或命令日志**。如果 token 曾在截图/聊天中暴露，验证结束后应在 Extension UI 中 regenerate，再按同一 SOP 更新本机 env。

Token 更新本身**不等于业务 Browser 控制恢复成功**。更新后必须重新跑连接验收：首次调用允许打开一个 `connect.html`，但它必须自动进入 `“Playwright MCP” connected.`；随后将业务页加入受控标签组，并验证 `browser_tabs` 可见、snapshot/screenshot 可读、navigation/多 Tab 切换可持续复用、短暂停后仍不产生第二条 relay。全部通过后才能把 Playwright 恢复为“每步眼睛”。

## 扩展身份

必须区分：**Playwright MCP Extension = 自动化控制基础设施**；**ProFlow Execution Browser Extension = 被测产品扩展**。二者绝不能因为都出现在 Chrome 扩展体系里而混为同一个对象；具体 Extension ID 可能变化，以当前 Chrome/runtime evidence 为准，不在长期 Runbook 写死。

## 四工具协同

```text
Repomix           → Context Plane：仓库上下文批量读取；窄域 pack 当前包，广域按证据扩张，一次 pack 多次 grep/read
CodeGraph         → Structure Plane：调用链、依赖、composition、ownership、blast radius
Local Dev         → Execution Plane：当前源码、文件、CLI、Git、PID/evidence、修改与 test/gate
Playwright Chrome → Reality Plane：真实网页、登录授权、ChatGPT Conversation、Console/Network、用户可见结果
```

协作不是固定四连调用，更不是四个工具各自把同一仓库重新读一遍。上下文必须逐层收敛：`Repomix` 只在最小充分范围内发现候选文件/目录 → `CodeGraph` 只围绕候选 owner/入口证明调用链与影响范围 → `Local Dev` 只补仍缺失的当前磁盘源码并执行修改/验证 → `Playwright` 只在需要用户现实证据时进入。禁止 `Repomix 全仓 → CodeGraph 再全仓 → Local Dev 再批量重读` 这种重复获取上下文。

仓库理解/修改任务统一：`Repomix 最小充分范围 → grep/read → CodeGraph（需要结构证明时）→ Local Dev`；窄域把范围锁定到当前 package / 最小相关目录，广域才按证据向父级、多包、领域或全仓扩张。纯 Git/test/command 机械动作可直接 Local Dev。真实 E2E 在源码/执行链之外按需加入 Playwright，固定 `Local Dev 建立产品前置 → Playwright 观察/操作真实 Web → Local Dev 回读 owner/runtime → Playwright 再确认用户可见结果`。最终只在与任务相关的 authority 一致时判 PASS。

## 2026-09-03｜Playwright Runtime / Tasks Tab 受控组经验

- Chrome Tab Group membership 与 Playwright debugger attach 是两层 authority：进组不等于 attach 成功；必须以 `browser_tabs + snapshot/DOM` 证明真正可控。
- 跨扩展 `chrome-extension://` target 即使进入 Playwright group，也可能被 Chrome 拒绝 debugger attach；这类页面退回 AX + screenshot，不继续消耗 Playwright attach 排障时间。
- loopback `http://127.0.0.1:<bridge>/tasks` 不受跨扩展 debugger 限制。Real-3 必须把 Extension action 打开的原始 Tasks Tab 加入 controlled group，而不是复制一个同 URL Tab。
- 对 Worker Conversation 同样遵守原 Tab 纳管：`/g/<roleRef>/c/<workerRef>` 创建后立即进组，禁止为了自动化再打开第二份 Conversation。
- Playwright 是普通业务页默认执行层；AX 只负责 Chrome privileged UI、group attach 等临界动作。完成 attach 后立即回 Playwright 后台操作，避免抢用户前台。

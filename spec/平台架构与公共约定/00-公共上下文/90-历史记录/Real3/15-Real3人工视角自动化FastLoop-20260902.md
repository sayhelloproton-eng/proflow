# Real-3｜人工视角自动化 Fast Loop

日期：2026-09-02

## 1. 最终目标

本轮自动化的最终目标不是继续优化 Deployment，而是完成 Real-3 J0→J4 的真实自动化验证。

自动化必须站在人类用户视角模拟操作现有产品：

```text
公开 CLI / 真实 Browser / 真实 npm Registry / 真实 Product Workspace
→ 观察真实输出与 Owner Facts
→ 按产品已有恢复路径继续
→ 不伪造、不旁路、不偷换实现
```

最终 Truth 是真实发布包在真实工作区中的真实行为，不是 repo source、单测或本地直接物化。

## 2. 冻结原则

已经稳定并通过真实验收的能力默认冻结。除非出现可复现真实 regression，只允许局部修复，不重新设计：

- `platform install`
- `platform setup`
- `platform status`
- 已冻结 Deployment 主链
- 已关闭且没有真实回归证据的 Real-3 核心语义
## 3. `platform update` 的一次性稳定性验证

`platform install` 只在 `platform update` 首次稳定性验证中用于建立可信基线。

```text
Fresh Product Workspace
→ bootstrap 已发布 platform-cli latest
→ platform install
→ 记录所有已安装包版本
→ 发布一个目标包新版本
→ platform update --package <packageName>
→ 再记录所有包版本
→ 证明只有目标包变化
→ 验证目标 Module.install / 工作区物化
→ platform start / status / stop 验证新行为
```

满足以上条件后：

```text
PLATFORM_UPDATE_STABLE=YES
```

之后日常 Real-3 修复不再 Fresh + 全量 install，而进入增量 Fast Loop。

## 4. Real-3 Fast Repair Loop

```text
Real-3 发现真实问题
→ 定位 owning package
→ 只做局部修复
→ package targeted gate
→ 版本发布到 npm
→ Registry exact readback
→ platform update --package <target>
→ 从失败的 Journey checkpoint 恢复
→ 验证真实 Browser / Owner Facts
```
## 5. 人工视角自动化禁止绕过

自动化只能替代人工操作现有功能，禁止为了“跑通测试”绕过产品合同：

- 禁止从 repo 直接复制源码到 Product Workspace 代替 npm publish/install/update。
- 禁止直接修改 `.proflow` 伪造 setup/runtime/Role/Worker/Execution READY。
- 禁止直接写 Owner DB 代替公开 Task/Worker/Execution API。
- 禁止用 Browser DOM 注入直接制造业务状态；Browser 自动化必须操作真实 UI / Extension 能力。
- 禁止把 API 返回 `ok` 当 Browser 真提交；必须观察真实 submitted user message / owner evidence。
- 禁止跳过 `platform update` 直接改 `node_modules`。
- 禁止为了测试方便新增与产品无关的旁路命令。

允许脚本化的是人的重复动作：清理、CLI 调用、版本读取、Registry readback、等待条件、截图、Owner Facts 查询、证据汇总。

## 6. 短任务与恢复纪律

闭环不是一个巨型长命令。每一步必须短、可观察、可恢复：

```text
单包 gate → STOP POINT
version/release plan → STOP POINT
publish → Registry readback → STOP POINT
Fresh → STOP POINT
bootstrap/install/update → STOP POINT
start/status/stop → STOP POINT
Browser Journey checkpoint → STOP POINT
```

非幂等操作若超时/中断，禁止盲目重试；先读取 Git / Registry / Workspace / Owner authoritative state。
## 7. 每轮经验必须落库

每个 repair loop 结束前追加一条 Round Record：

```text
ROUND_ID
目标 / owning package
失败点与真实证据
本轮修改
执行步骤与各步骤耗时
哪些动作可脚本化
哪些动作不该重复
恢复 checkpoint
下一轮预计最短路径
结果：PASS / FAIL / UNKNOWN
```

经验必须转化为下一轮行为变化，而不是只写总结。

## 8. 已沉淀经验

### Round 0｜2026-09-02

- 错误：把 5 个 package gate 与后续 release 连成连续长执行，触发 Chat 长任务。
- 修正：package gate、release、Fresh、install/update、start、Browser Journey 分成独立 STOP POINT。
- 错误：容易把“闭环”理解成每次 Fresh + install。
- 修正：Fresh + install 只用于一次性证明新 `platform update`；稳定后改为 package-level incremental update。
- 错误：源码候选通过容易被误认为工作区已修复。
- 修正：必须 `publish → Registry exact → platform update/install → real behavior` 后才能判定 EFFECTIVE。
- 加速：已完成的可靠 gate 不机械重跑；失败后从 authoritative checkpoint 恢复。

当前主线：先完成 `PLATFORM_UPDATE_STABLE=YES`，随后立即进入 Real-3 J0→J4 自动化。

### Round 1｜Update 稳定性基线（进行中）

- Release version：Browser Extension `0.1.26`、Platform CLI `0.1.51`、Platform Host `0.1.15`、Task Orchestration `0.1.10`。
- Release：4 包均已 publish，release 日志确认 `Registry exact PASS`。
- bootstrap：全局 `platform-cli@latest` → `0.1.51`，耗时约 42s。
- Fresh Workspace：通过仓库既有 `fresh:workspace`，未直接手删 Product Workspace；完成。
- Fresh stop：1 个 Module 实际停止，22 个跳过，0 fail。
- `platform install` Registry discovery：23 包耗时约 221.4s，属于一次性高成本路径。
- 经验：验证 `update` 后，Real-3 repair loop 禁止默认回到 Fresh/install；否则每轮至少浪费数分钟。
- 当前 checkpoint：`INSTALL_DEPENDENCY_SYNC`，等待一次性基线 install 完成。
- 下一步：记录基线 23 包版本 → 发布/选择目标增量版本 → `platform update --package` → 证明 sibling 版本不变 + 新行为生效。

### Round 1 补充经验｜并发 Chat 隔离

- Local Dev 执行历史/进程可能来自同一机器上的其它 Chat，不能仅凭 PID 或命令文本判断 ownership。
- 每个自然长步骤必须建立唯一 `ROUND_ID`、专属 log、专属 pid file；当前轮只读取/终止自己登记的 PID。
- 当前恢复 install：`ROUND=R1`，`PID=17613`，log=`/tmp/proflow-real3-r1-install.log`。
- 对其它未登记进程只读观察，不 kill、不复用其 UNKNOWN 结果做 PASS。
- 自然耗时较长但产品功能本身必须真实执行时，允许后台执行公开命令 + 短轮询日志；这只是自动化调度方式，不改变产品路径。

### Round 1｜一次性 Fresh install 完成

- 恢复命令仍是公开 `platform install`，没有直接操作工作区内部事实。
- Registry discovery：105.3s。
- dependency sync：14.2s。
- installed Module validation：23/23，0.8s。
- Module.install：23/23 SUCCEEDED。
- 结论：Fresh/install 只保留为新环境与灾难恢复路径；不进入后续 Real-3 日常 repair loop。
- 下一 checkpoint：记录 23 包基线，并验证 `platform update --package` 的定向重物化与耗时。

#### Product Workspace 23 包基线

```text
agent-controller-dev=0.1.16
agent-gateway=0.1.15
agent-product=0.1.16
agent-runtime=0.1.13
agent-test-ops=0.1.16
chrome-runtime=0.1.15
deployment-conformance=0.1.13
dev-tunnel=0.1.25
execution-browser-extension=0.1.26
execution-contracts=0.1.10
execution-local=0.1.15
execution-runtime=0.1.15
model-contracts=0.1.10
model-provider-api=0.1.17
model-runtime=0.1.20
module-contract=0.1.13
module-skill=0.1.11
module-template=0.1.10
platform-cli=0.1.51
platform-host=0.1.15
task-migration-runner=0.1.11
task-orchestration=0.1.10
task-store-sqlite=0.1.11
```

### Round 1｜`platform update` 同版本真实路径

- 命令：`platform update --package @tomflow/proflow-execution-browser-extension`。
- Registry：只查询目标包，目标 `0.1.26`。
- 结果：目标已是 latest；未执行无意义降级/升级；复用 `Module.install` 完成工作区重物化。
- Product Workspace materialization：`moduleVersion=0.1.26`。
- true-submit 标志已真实物化：sent user message selector + `MESSAGE_SUBMIT_REALITY_UNCONFIRMED`。
- 结论：target lookup + same-version idempotent materialization 已验证；真正 N→N+1 mutation 留给第一项真实 Real-3 修复，不人为制造版本变化。
- 加速经验：同版本 update 可以作为“确认发布包已物化”的快速恢复动作；不得因此宣称 version mutation 已验证。

### Round 1｜Fresh 后真实 status

- `platform status`：23 Module 真实读取完成。
- setup progress：`0/3`。
- 当前步骤：Browser Extension；原因是扩展未加载/缺少可验证运行证据。
- 下一步由产品明确给出：`platform setup`。
- 自动化裁决：复用现有 `scripts/human-e2e/platform-setup.exp`，因为它通过真实 `platform setup` + Browser UI helper 模拟人工操作；不写 `.proflow`，不绕过 setup。
- Browser helper 已按 source digest 缓存 Swift binary，可避免每轮重复编译成本。

### Round 1｜Browser setup harness 焦点竞争

- 真实截图确认 Chrome 已存在“扩展程序”Tab，但前台被 Playwright Welcome Tab 占用。
- 现有 Swift helper 使用 Accessibility 在当前 Chrome UI 查找 `Load unpacked`；前台 Tab 被其它自动化抢走时会失去目标 UI。
- 这是 human-E2E harness 问题，不是 Browser Extension 产品问题；禁止因此改 Extension/setup 业务逻辑。
- 修复原则：Browser helper 自己保证 `chrome://extensions` 成为当前活动 Tab，再继续真实 `Load unpacked → 系统目录选择器 → Select`。
- 运行 Browser helper 时不再调用 Playwright 抢前台；Playwright 只在 helper STOP POINT 之后做页面/结果验证。

### Round 1｜PAIRING_TIMEOUT 分层

- Pairing contract 默认 timeout：120s。
- 首次 Browser helper compile：187.455s；已超过 pairing hard timeout，足以独立解释本轮失败。
- Browser helper UI action：13.744s，结果 `ALREADY_PRESENT`。
- 下一实验不改产品：复用已缓存 helper，再跑同一 `platform setup`。
- 判定：若成功，则把 helper prewarm 固化到 human-E2E setup；若仍 timeout，再单独验证 stale existing Extension session 的人工 recovery。

### Round 2｜Browser harness 加速与 pairing 重试

- 原因：R1 pairing 120s 超时，但 helper 首次编译 187.455s，自动化耗时污染产品结果。
- Harness 最小修正：AX 扫描限定到 Chrome focused window；setup 需要重新配对时按人工恢复路径 `Remove → 系统确认 → Load unpacked`。
- R2 prewarm：`BROWSER_HARNESS_COMPILE_SECONDS=38.757`，`BROWSER_UI_SECONDS=2.809`，`BROWSER_UI_RESULT=PRESENT`。
- 规则：Browser UI helper 必须在 pairing 临界区前预热；helper 操作期间禁止 Playwright 抢 Chrome 前台焦点。
- 下一 checkpoint：原样运行公开 `platform setup`，不直接写 pairing evidence。

### Round 2.1｜Go To Folder 误判

- `uninstall` 真实 UI 成功：6.297s。
- `install` 截图显示 Cmd+Shift+G 的“前往文件夹”面板已真实出现，但旧 harness 用 text-field 数量变化判断，误报 `GO_TO_FOLDER_SHEET_NOT_VISIBLE`。
- 修正：直接识别“前往：/Go to the folder”真实面板；不再依赖文本框数量。
- 新增 `browser-extension-ui.mjs --compile-only`：编译缓存与 Browser UI 操作解耦，避免预热改变 Chrome 状态。
- 本轮失败归类：AUTOMATION_HARNESS，不是产品 Browser Extension / pairing 回归。

### Round 3｜Browser 配置闭环，进入 Dev Tunnel

- `BROWSER_UI_RESULT=ALREADY_MISSING`，16.697s；随后真实 `Load unpacked` 成功，`BROWSER_UI_RESULT=INSTALLED`，30.292s。
- Chrome 被动截图确认 `ProFlow Execution Browser 0.1.26` 卡片真实存在；setup 随后越过 Browser 阶段，证明 pairing/heartbeat 已成功。
- `platform setup` 最终推进到 `1/3`，当前真实阻塞变为远程连接。
- 新错误：`DEV_TUNNEL_VERSION_INCOMPATIBLE: unknown`；这是产品 Dev Tunnel setup 阻塞，不归类为 Browser harness。
- 经验：Browser helper 修复后下一轮无需再 Fresh/install；Browser READY 应由 `platform status` 复用，不重复 Remove/Load，除非状态再次证明 Browser 失效。

## Round 4｜Dev Tunnel 登录事实恢复与 Fast Loop 固化

- `platform update` 已完成真实 N→N+1：`dev-tunnel 0.1.25 → 0.1.26`，Registry exact + Workspace installed version + Module.install 均有真实证据，因此 `PLATFORM_UPDATE_STABLE=YES`。
- 从本轮开始，日常修复路径固定为：问题 → owning package targeted gate → publish → Registry exact → `platform update --package` → 从产品 checkpoint 恢复；不再 Fresh/install。
- tarball smoke 仅作为 publishability 异常时的诊断手段，不进入常规 Fast Loop。
- Dev Tunnel `user show --json` 在本机超时，但 verbose partial output 已明确显示 cached GitHub access token expired；超时不等于事实不存在。
- 修复原则：正常 JSON 仍权威；仅当短时 verbose fallback 出现明确 expired/not-logged-in 证据时判 `NOT_LOGGED_IN` 并进入一次真实 GitHub 登录；其它 UNKNOWN 继续 fail-closed。
- 本轮 gate：Dev Tunnel 38/38 tests PASS，typecheck PASS。
- 自动化恢复经验：终端会话被回收后，使用 `read_process_output(pid, offset=-N)` 读取 archived output，不重复启动同一产品命令。

## Round 5｜Playwright Browser Control 误判事故

- 事故：仅确认 `playwright-chrome runtime=READY` 后，为了“看 GitHub Auth 页面”直接调用 Playwright，两次触发 `chrome-extension://.../connect.html`，给真实 Chrome 引入与产品无关的连接授权噪声。
- 根因：把 tunnel/runtime transport healthy 错当成 browser-side attach/control READY；二者不是同一个 authority。
- 裁决：`runtime READY != browser attach/control READY`。首次使用、runtime 恢复、浏览器重启、扩展重载或连接状态不明后，必须先通过 Browser Control 硬门；如果无法在不触发新连接授权的情况下证明实际可控，则 Browser control = `UNVERIFIED`，禁止 Playwright 调用。
- `connect.html` 不是 ProFlow 页面、不是 Dev Tunnel GitHub Auth、不是产品 blocker。一旦出现：停止 Browser mutation；不点击、不复制 token、不重启 Chrome、不重装扩展、不继续调用 Playwright建立第二条控制链。
- 当前恢复：优先使用 Local Dev、产品日志、Owner/runtime evidence 继续业务诊断；只有工具链真实需要恢复时才按 `gptweb-mcp/tunnel-client` authority 修复。
- 稳定知识已写回：`基础动作/Tool-Runtime-gptweb-mcp.md`、`基础动作/Browser-UI自动化.md`、`CURRENT.md`。

## Round 6｜Dev Tunnel 0.1.28 真实 setup 推进

- Product Workspace 已真实运行 dev-tunnel 0.1.28；R6 canonical `platform setup` 越过旧 `Dev Tunnel login status is UNKNOWN`。
- 真实结果推进为：`SETUP_FAILED — Dev Tunnel login was not confirmed after authentication`，setup 仍为 1/3。
- 这证明 0.1.28 timeout-evidence 修复在 Product Workspace 生效：expired/not-logged-in 已足以进入 authentication branch；当前 blocker 已变成认证事务返回后的 post-login confirmation。
- 下一步禁止重跑 setup；只恢复 R6 auth/post-login 的真实证据，判断 login command 是否真实成功、post-login status 是否仍 expired/timeout/UNKNOWN。

## Round 6.x｜Playwright Chrome 工具链反复 connect.html 根因

- 本轮因错误地把 `gptweb-mcp/tunnel-client READY` 当成“业务 Tab 已正确可控”，连续调用 Playwright tabs/screenshot，反复拉起 Playwright Extension `connect.html`，产生明显用户干扰。
- 本机真值：Playwright Extension `0.4.0`；`@playwright/mcp 0.0.80` / playwright-core `1.63.0-alpha-2026-08-31`；`tunnel-client 0.0.11`；wrapper 为 `playwright-chrome-mcp.sh → source playwright-chrome.env → npx -y @playwright/mcp@latest --extension`。
- 根因 A：当前 Extension token auto-approval 在 token 匹配时不传目标 Tab，background 回退到 sender tab，因此实际控制 `connect.html` 自身。Microsoft Playwright #41651 与 #42343、当前本机 Extension 源码均一致；Chrome debugger banner 只证明某个 Tab 被 attach，不能证明业务 Tab 正确。
- 根因 B：本机 tunnel-client 日志长期出现 `MCP connection TTL reached → stdio ... file already closed → shutdown/restart`。这与 OpenAI tunnel-client #34 的 v0.0.11 shared-stdio response-deadline bug 完全一致。runtime/backend 重建后 Playwright MCP 会新建 extension relay，而 relay 建立按设计会再次打开 connect page。
- 因此“反复 connect.html”不是单一 attach 判断问题，而是 **token 自选错 Tab + tunnel-client shared-stdio 生命周期重建** 两条链叠加。
- `mcp.connection_max_ttl` 可配置但不能修复 response-deadline 关闭 shared stdio；上游新协议要求非 initialize deadline 保留 process-affine child pipes。
- 工具链修复前禁止继续调用 Playwright 试探。修复完成后 Browser 自动化固定为 `act → Playwright observe → authority readback → next`；Browser authority 必须指向实际业务 Tab。
- 本轮页面/聊天中 Playwright extension token 已暴露；完成连接路径修复后必须旋转 token，且后续任何日志/文档不得记录 token 值。

## 2026-09-03｜Playwright Chrome 真实恢复验收

- Extension 当前 token 已同步到 `playwright-chrome.env`；`gptweb-mcp restart` 后 runtime ready。
- 首次 Playwright 调用打开一个 `connect.html`，自动显示 `“Playwright MCP” connected.`：relay/client bootstrap PASS。
- `browser_tabs` 初始只看到受控标签组；`browser_tabs new` 加入业务页后，tabs/snapshot/screenshot/navigation/多 Tab 切换 PASS。
- 短暂停后 screenshot + tabs 仍复用同一连接，没有产生第二条 relay；测试页最终全部清理。
- `browser_click` 在 Example 与 httpbin 两个普通 Web 页面均复现：locator 已命中，但 actionability `visible/enabled/stable` 等待 5s timeout；连接、截图、DOM 读取均保持正常。
- 键盘 fallback 真实 PASS：httpbin 表单 `Shift+Tab` 聚焦 Submit（截图确认 focus ring）→ `Enter` → 真 POST `/post`（截图确认结果页）。
- 裁决：Browser connection/tool observation = PASS；`browser_click` actionability = 独立工具限制，不能误判为断线；等价场景优先真实 keyboard path + screenshot。

# ProFlow Phase 3｜Deployment Closeout 循环测试进度计划书

> 建立时间：2026-08-30
> 最新整合：2026-09-01
> 性质：Deployment Final Freeze 记录 / 历史 Closeout 过程；不再定义当前 Gate
> 当前状态：`DEPLOYMENT_TECHNICAL_MAINLINE = PASS`；`DEPLOYMENT_PRODUCT_ACCEPTANCE = PASS`；`DEPLOYMENT_SUCCESS = YES`。Deployment Closeout 已结束。

## 1. 当前唯一目标

Deployment latest 技术主链与最终 Product Acceptance 均已通过。以下完整、不可裁剪的 Fresh Deployment E2E 已作为本轮最终证据执行完成：

```text
O1～O7 当前已裁决优化源码 / changeset intent 已落盘
→ changed packages 包级 release
→ Registry exact/latest readback
→ 若 platform-cli 变更：升级真实全局 platform-cli latest
→ Fresh Product Workspace
→ 全局 platform install / status / setup
→ Browser Extension / Dev Tunnel / Model / 3 GPT
→ platform start / final status
→ repeat setup / repeat status / normal stop → start → status
→ Product Acceptance 四项门
→ Deployment Closeout 结束
→ 回到 Real-3
```

最终“部署好”的产品口径冻结为：技术真实可用 + 用户心智最低 + 自动化最大化 + CLI 交互好用 + 默认输出明确。本轮四个产品门已全部通过，非阻断微小 polish 作为 Deployment 后优化项继续记录，不反向推翻 `DEPLOYMENT_SUCCESS=YES`。

## 1.1 循环测试的唯一主视角

**本计划书中的“循环测试”默认且永久指：模拟普通用户真实视角，对 ProFlow Deployment 做真实系统端到端测试，直到完整部署目标成立。**

每一轮都必须从用户真正能接触到的产品面开始：

```text
真实 npm Registry/latest
→ 真实 Product Workspace
→ 公开 platform install / status / setup / start / status
→ 真实 Browser Extension / Dev Tunnel / Model / 3 GPT
→ repeat setup / repeat status / normal stop → start → status
→ Product Acceptance
```

测试者不能因为自己知道源码而缩短用户路径；不能通过内部 package CLI、手工状态修改、内部文件注入、已知端口/ID 或历史 evidence 把失败“修成成功”。这些只能作为失败后的诊断证据，不能作为用户 E2E 的执行步骤。

循环固定为：

```text
模拟用户端到端执行
→ 发现真实阻塞/不舒服/不明确/不必要人工动作
→ 保存现场并归类 root
→ 临时切换总控/工程视角最小修复
→ targeted regression
→ 回到同一用户步骤重新执行
→ PASS 后继续下一用户步骤
→ 直到技术真值 + 四项产品门全部 PASS
```

最终验收问题只有一个：**一个不了解 ProFlow 内部架构的正常用户，是否能在最低心智和最低人工介入下，被产品清晰地带到真实 READY，并能稳定恢复和重复执行。**

## 1.2 Fresh Workspace 清理已脚本化

完整 Deployment E2E 的 Fresh 步骤不裁剪，但其机械清理已固定为：

```text
pnpm fresh:workspace --workspace /Users/agent/Desktop/proton-workspace
```

该 Harness 使用删除白名单并保护 `repos/`；在 package manifest 出现非 ProFlow 内容时 fail-closed。循环测试禁止重新手拼多条删除命令。需要先观察计划时使用 `--dry-run`。

## 2. 当前权威现场快照

> 易变化事实接管时必须机械重读。

```text
Source Repo        = /Users/agent/Desktop/proton-workspace/repos/proflow
Product Workspace  = /Users/agent/Desktop/proton-workspace
Latest deployment code commit = 428edb5
Latest release machinery commit = cc3ff34
Current Git HEAD / WorkingTree = 接管时机械重读
DEPLOYMENT_TECHNICAL_MAINLINE = PASS
DEPLOYMENT_PRODUCT_ACCEPTANCE  = PASS
DEPLOYMENT_SUCCESS             = YES
Current Gate                   = DEPLOYMENT_CLOSEOUT_COMPLETE → REAL_3_J0_J4
```

Source versions：

```text
@tomflow/proflow-platform-cli                 0.1.50
@tomflow/proflow-dev-tunnel                   0.1.25
@tomflow/proflow-execution-browser-extension  0.1.25
```

最后机械确认 Registry latest：

```text
platform-cli = 0.1.50
dev-tunnel   = 0.1.25
browser      = 0.1.25
```

2026-09-01 Final Freeze 机械回读：`platform-cli@0.1.50`、`dev-tunnel@0.1.25`、`execution-browser-extension@0.1.25` 均与 Registry `latest` 一致；`agent-runtime@0.1.13`、三个 Role package `0.1.16` 同样一致。

Final Freeze 使用真实 npm-owned Product Workspace：全局 `platform-cli=0.1.50` 作为 Fresh bootstrap，随后 23 包 install、Browser Fresh load、Dev Tunnel、Model、Role provisioning/recovery 均完成真实当前 evidence。最终 `platform status`：

```text
配置进度 3/3
Browser = 已完成
Remote  = 已完成
Model   = 已完成
PLATFORM_READY=YES
```

最终裁决不再要求补跑性能基线：首次 Browser `PAIRING_TIMEOUT` 作为测试操作因素忽略；单次 Tunnel/Gateway 异步现象由公开 repeat setup 恢复；Registry discovery 约 112s 已由用户裁决可接受。以上均为 `NOT_BLOCKER`，Deployment 不因这些历史观测继续重跑。

## 3. Deployment latest 技术主链 PASS 证据

| Gate | 状态 | 当前真实证据 |
|---|---|---|
| npm latest / Product install | PASS | 23 个 ProFlow 直接依赖当轮 `npm outdated={}`；真实 Product Workspace npm-owned |
| platform setup | PASS | 3/3 core setup 完成 |
| platform start | PASS | 首次启动成功；历史 repeat start 仅保留为既有证据，不再是最终每轮 E2E 必测项 |
| final status | PASS | `PLATFORM_READY=YES` |
| listeners | PASS | `41705/47080/51443/55225/56107` 全部真实 LISTEN |
| Browser 0.1.25 | PASS | 真实 Chrome Fresh load → enabled / Service Worker → pairing / live heartbeat → READY |
| Dev Tunnel | PASS | owned Tunnel persisted；公网 HTTPS 到达 Gateway auth boundary，返回 401 AUTHENTICATION_FAILED |
| Model | PASS | `/ready` fast/reason READY；FAST 和 THINK 都完成真实 `/infer` |
| 3 GPT carrier | PASS | 三个 Final-Fresh GPT 在真实登录 Chrome 逐个打开并与 owner-local identity 对齐；不做“是否重建”专项断言 |
| repeat/recovery scope | PASS | 历史 repeat setup/start/status 与 stop→start 已成立；未来最终 E2E 只重跑冻结的最小真实用户集合 |
| no Fake READY | PASS | Browser READY 必须来自当前 Fresh load + pairing / live heartbeat + `platform status` 真值，不能只凭历史 evidence |
| Technical mainline | **PASS** | 真实安装/setup/start/status + Browser/Tunnel/Model/3 GPT + recovery/idempotency 已成立 |
| Product acceptance | **PASS** | 最终真实 npm latest + Fresh Product Workspace 完整 E2E 已由用户裁决通过 |
| DEPLOYMENT_SUCCESS | **YES / FROZEN** | Final Fresh + lifecycle/recovery 主链 PASS；无剩余 Deployment blocker |

## 3.1 已完成 Recovery / Fail-closed 回归基线

```text
repeat install/setup/start = PASS
stop → start = PASS
Dev Tunnel host-down/same-Tunnel recovery = PASS
Model unreachable fail-closed/recovery = PASS
partial install fail-closed = PASS
package-manager conflict pre-mutation = PASS
running uninstall stops owner/listeners before package removal = PASS
uninstall/reinstall durable identity preservation = PASS
```

历史 Recovery 证据继续作为诊断基线。为缩短自动化测试时间，发布后最终 Fresh E2E **不再泛化重跑 recovery / repeat / idempotency 全集**；只保留 `repeat setup`、`repeat status`、正常 `platform stop → platform start → platform status`。明确不跑 repeat start，不做 Browser/Tunnel/Model/GPT “是否重建”专项断言，也不主动制造异常。

## 4. Deployment Product Acceptance 四项最终 Gate

最终完整 latest Fresh Deployment E2E 不能只看 exit code 和 `PLATFORM_READY=YES`，还必须模拟第一次使用 ProFlow 的普通用户，逐项判断：

| Gate | PASS 标准 | 明确 FAIL 信号 |
|---|---|---|
| 用户心智最低 | 用户只理解 install/setup/start/status、当前步骤和必要人类动作 | 要求理解 moduleRef、端口、Tunnel ID、shared facts、owner、provider inventory 等内部实现 |
| 自动化最大化 | machine-owned / producer-owned / 可安全恢复动作全部自动完成 | 重复询问已有事实、要求执行 package CLI、让用户手工恢复机器本可恢复状态 |
| CLI 交互好用 | 明确正在做什么、为什么停、只需做什么、完成后下一步；可重入/取消/恢复 | prompt 含糊、多个动作同时抛给用户、失败后不知道如何继续 |
| 默认输出明确 | 默认聚焦当前状态 + 唯一 root cause + 下一步 + 最终结果 | 23 Module traversal、重复 Registry 核验、错误服务计数、内部诊断噪声淹没用户决策 |

这四项必须通过真实发布后的**完整 Product Workspace Fresh Deployment E2E**取证，不能仅凭源码 review、unit test 或历史 smoke 宣告 PASS。O1～O7 是当前已裁决的直接整改实现；后续继续逐项裁决，完成后统一 release。

## 5. O1～O7 当前已裁决优化批次

```text
O1 PASS  install 默认隐藏 Registry package-by-package 核验
O2 PASS  setup 默认隐藏 23 Module traversal / skip
O3 PASS  Dev Tunnel read-only query 45s bounded window；timeout 最多重试一次；mutation 不重试
O4 PASS  删除不可信服务/进程数量默认输出
O5 PASS  uninstall 成功/停止措辞收敛
O6 PASS  默认 CLI 聚焦当前状态 + root cause + 下一步
O7 PASS  Browser 静态安装物按版本幂等物化；真人模拟只保留 Fresh Load unpacked + 真实 Remove；删除 Reload / Disable-Enable 主动测试用例
```

源码验证：

```text
platform-cli tests = 86/86 PASS
platform-cli typecheck = PASS
dev-tunnel tests = 35/35 PASS
dev-tunnel typecheck = PASS
execution-browser-extension tests = 96/96 PASS
execution-browser-extension typecheck = PASS
test governance = 0 errors
git diff --check = PASS
source CLI against real Product Workspace status/setup UX = PASS
```

提交：

```text
3e91e9b fix(deployment): streamline cli and tunnel recovery ux
e3151f7 chore(release): version deployment ux closeout
67a371c chore(release): add package-scoped release flow
e30f9d2 fix(release): drive package publish from pnpm changesets
d768615 perf(browser): streamline extension install acceptance
```

历史 release state（2026-09-01 中途一致性审计；已被 Final Freeze 版本覆盖）：

```text
platform-cli source 0.1.49 / Registry latest 0.1.49
dev-tunnel   source 0.1.22 / Registry latest 0.1.22
browser      source 0.1.22 / Registry latest 0.1.22
```

release preflight 已裁清：pnpm 11 对“已经 version 但尚未 publish 的 release bucket”允许新 patch intent 合并到同一目标版本，因此 `dev-tunnel 0.1.21 → 0.1.21` / `platform-cli 0.1.48 → 0.1.48` 是正常 changeset/ledger 语义，不是异常。隔离副本验证后已完成真实 release。

## 5.1 Dev Tunnel 优化裁决与实现已完成

Dev Tunnel 本轮裁决已全部结束并按冻结结果实现；不再保留 D0～D3 “待裁决”状态。

```text
D0 PASS  删除独立 packages/devtunnel-cli；@tomflow/proflow-devtunnel-cli Registry 历史包已 deprecated。
         CLI resolver 收归 @tomflow/proflow-dev-tunnel；固定 1.0.2030，从 Microsoft 官方源下载到 package-local
         .devtunnel/<version>/<platform-arch>/devtunnel，SHA/version 校验 + 120s bounded download；绝不使用 system PATH。
D1 PASS  Fresh ownership 改为 deterministic workspace Tunnel identity：
         proflow-${sha256(resolve(workspaceRoot)).slice(0,24)}。
         无 local state 先 show stable ID；EXISTS 复用、MISSING 才 create、UNKNOWN STOP。
         有旧 local state 时先 show previous；只有 previous MISSING 才进入 stable-ID recovery。
D2 PASS  create 使用预先已知 stable ID；create 成功返回后先持久化 PENDING_CREATED，再 show 验证，关闭
         “remote 已创建但 post-create show timeout 导致 tunnelId 未落盘”的窗口。
D3 PASS  同一 setup 已确认 login 后，host.start 复用 loginVerified，不再重复 user show；Public URL discovery
         保留最多 3 轮 eventual-consistency show，但每轮不再嵌套 timeout retry，最坏 6 次 show 收敛为最多 3 次。
```

明确保持不变：

```text
PORT_BRANCH = KEEP_CURRENT
HOST_BRANCH = KEEP_CURRENT
```

Port 仍然只 reconcile 当前 Gateway exact port；`http` 已存在直接复用、缺失创建、协议漂移仅删除 exact port 再创建；不新增 mutation timeout recovery 状态机。Host 仍以 owned process + remote host reality 防重复启动，不新增 takeover / kill / duplicate-host recovery 状态机。

最终 Public URL / READY ownership 冻结为：只接受当前 Gateway port 的 HTTPS URI，并验证 owned host + HTTPS:443 + TLS>=1.2；Dev Tunnel start 不等待 downstream Gateway HTTP。应用层 `/health` / Action reachability 由 Gateway/Carrier 后续 owner 验证；完整 E2E 的 protected ingress 401 可作为到达 Gateway auth boundary 的正向 evidence。

`@tomflow/proflow-module-contract` 保留：它提供 `ModuleCommandContext` 与跨 Module shared facts，Dev Tunnel 用它消费 `agent-gateway.localBaseUrl` 并发布 `tunnelId/publicBaseUrl`，不属于本轮被裁掉的 CLI wrapper。

本轮真实验证：

```text
package-local CLI = packages/dev-tunnel/.devtunnel/1.0.2030/darwin-x64/devtunnel
CLI mode/version   = executable / 1.0.2030
dev-tunnel         = 34/34 tests + typecheck PASS
platform-cli       = 85/85 tests + typecheck PASS
deployment-conformance = 17/17 tests + typecheck PASS
surface governance = 23 packages / 91 exports / 14 binaries / 0 errors
test governance    = 39 plans / 316 formal cases / 144 files / 649 calls / noMapping=0（生成物刷新后 0 errors）
```

npm retirement：`@tomflow/proflow-devtunnel-cli@*` 已执行 deprecated；`0.1.1` Registry exact readback 为 `RETIRED: integrated into @tomflow/proflow-dev-tunnel; do not install this package.`。

Dev Tunnel patch intent 已被 2026-09-01 release 消费。pnpm 11 已验证会把新 intent 合并进尚未发布的 `0.1.21` release bucket；同理 platform-cli intent 合并进 `0.1.48`，Browser 正常生成 `0.1.22`。三包均已发布并完成 Registry exact/latest 回读。

## 5.2 最终 Deployment E2E 自动化范围已冻结（提速规则）

目标是**缩短循环自动化时间，同时不削减部署主链真实性**。主链仍完整执行：Registry latest → Fresh → install/status/setup → Browser/Tunnel/Model/3 GPT → start/final status。主链之后不再把工程 recovery 测试全集塞进每一轮部署验收。

```text
FINAL_REPEAT_RECOVERY =
  repeat platform setup
  + repeat platform status
  + normal platform stop → platform start → platform status

EXCLUDED_FROM_FINAL_E2E =
  repeat platform start
  Browser/Tunnel/Model/GPT “是否被重建”专项验证
  人为删 Tunnel / 改 port / 断网 / 杀半套进程 / 损坏 state / Reload / Disable-Enable 等人工故障注入
```

Model 最终用户交互同步冻结：用户只提供机器无法推导的 Provider Base URL / 必要 secret；已有有效 URL 直接复用；inventory、真实 capability probe、FAST/REASON 映射全部机器完成。只有多个已经合格且无法自动唯一决策的候选才请求用户选择；URL/inventory/probe UNKNOWN 必须 fail-closed。普通用户不应理解 provider/runtime module、inventory、modelRef 或 shared facts。

3 GPT 保持现有 create-only 实现和既有验证，不新增 Fresh recovery / lookup / reuse 设计，也不新增“是否重复创建”的专项自动化测试。

## 5.3 2026-09-01 Browser/TTY Harness 事故复盘与冻结结论

本轮最终 FULL FRESH 暴露的主要问题不是 Browser Extension 产品功能，而是**测试 harness 没有复用已经验证过的稳定路径**。具体错误链：

```text
卸载：临时重写 AX helper
→ 父层级取错 / 错误 Remove 关联 / confirmation bubble 不暴露 AX
→ 多轮无效定位与截图恢复

安装：Load unpacked 路径正确
→ “进入目录”和“Select”两个 Enter 连续发送
→ 文件选择器尚未 ready，Select 未真正触发
→ pairing 等待窗口被测试机器人消耗

TTY：宽泛匹配 Yes
→ Clack 重绘重复命中
→ 后续尝试方向键“强制 Yes”反而把默认 Yes 切成 No
```

根因固定为四层：`稳定流程复用失败 / harness 职责分散 / 事件已发送被误当状态已完成 / HARNESS_OVERHEAD 污染性能统计`。本轮功能 evidence 保留，但 FULL FRESH 总耗时作废，不得作为最终产品性能基线。

新的冻结执行规则：Browser Extension install/uninstall 必须只有一份仓库内可执行 helper；状态机固定为 `locate → mutate → wait visible state → verify`。安装必须把 `进入 loadDir` 与 `Select` 拆成两个可观察步骤；卸载确认 bubble 使用已验证的默认键盘确认。CLI prompt 必须按具体公开问题顺序单次响应。**禁止再次在最终验收现场临时创建第二套 `/tmp` UI/TTY helper。**

3 GPT / Custom GPT 浏览器创建流程与本事故无关，继续 `FROZEN / DO NOT TOUCH`。

## 6. Final Freeze 后唯一 Next Action

```text
Deployment = PASS / FROZEN
→ 不再做 Deployment 瑕疵扩展、补跑或 release
→ 仓库文档 / Test Plan / executable tests / code consistency 封版
→ CURRENT_GATE = REAL_3_J0_J4
```

只有新的、可复现并足以推翻冻结合同的 regression evidence 才允许正式重开 Deployment；历史偶发和已裁决体验项不构成重开条件。

## 7. 发布纪律

```text
changed / affected package
→ package gate
→ pnpm change 记录 .changeset intent
→ commit（代码 + 测试 + changeset）
→ pnpm package:release
→ pnpm version -r 根据 changeset 自动计算/应用 release set
→ package-owned version facts sync + release facts commit
→ 仅 release set 做 selected build / publishability
→ Registry exact preflight
→ pnpm publish -r --filter <pnpm release-plan packages...>
→ Registry exact verify
→ 完整 Fresh Deployment E2E
```

`.changeset` 是发布意图唯一真源；release 阶段禁止再次手填 changed package list。`package:release` 只约束 pnpm 原生 change/version/publish：pnpm 负责 semver 与 workspace 依赖传播，脚本负责 clean-tree、version facts、自动 release commit、selected validation、filtered publish 与 Registry 权威回读。已 version 未 publish 时允许从最近一次 changeset ledger commit 自动恢复。

- `npm publish` 在当前 Deployment 优化收口授权内；`git push` 不在授权内。
- publish timeout/UNKNOWN → 先 exact readback，禁止盲目重发。
- Browser 0.1.21 已发布，绝不重复 publish **同版本**；O7 的新版本必须由 pending changeset 正常 version 后再发布。
- 不删除远端 Dev Tunnel。
- 不删除/重建 3 个 GPT。
- 不读取、打印或提交 token/Bearer/API Key/credential。
- Fresh Deployment 的首个 `install` 必须使用真实 npm 全局 `platform`；Fresh 清理不会删除该全局 CLI。禁止先往 Product Workspace 本地安装 platform-cli 作为 bootstrap。
- `platform install` 后 Workspace 内出现的 `./node_modules/.bin/platform` 是受管 Package 安装物；后续同一 Workspace lifecycle 可用于交叉核验，但不得混淆为 Fresh bootstrap 入口。

## 8. 完整 Fresh Deployment E2E 的 PASS / FAIL

### PASS

```text
Registry latest = Final Freeze 当前真实版本（platform-cli 0.1.50 / dev-tunnel 0.1.25 / browser 0.1.25）
→ 全局 platform-cli = Registry latest
→ Fresh Product Workspace
→ platform install / initial status / setup
→ Browser / Tunnel / Model / 3 GPT 全部真实验证
→ platform start / final status = PLATFORM_READY=YES
→ repeat setup + repeat status + normal stop→start→status
→ Product Acceptance 四项门全部 PASS
```

### FAIL

完整 Deployment E2E 任何一步真实失败都保存现场、定位 root、最小修复并回到同一用户路径重放；不得用历史 PASS 省略本轮步骤，也不得把完整 Journey 改成最小 smoke。

## 9. 验证强度

历史 Closeout 中，release transaction 只对发生版本变化的 Package 做 selected version-sync/build/publishability/Registry publish/readback；**没有新源码修改时禁止重新跑整套 `pnpm check` 只为“更放心”**。Final Freeze 已完成真实 Fresh Deployment E2E；当前仓库封版只验证本次文档/测试治理改动，不再重跑 Deployment Journey。

若完整 E2E 暴露新源码 root cause：

```text
真实复现
→ CodeGraph 定位 blast radius
→ Local Dev 当前源码验证
→ 最小 fix
→ targeted/affected regression
→ 原普通用户 E2E 场景重放
→ 必要时 pnpm change 记录新 patch intent
```

## 10. 工具与效率规则

跨项目可复用的自动化模拟人工提效方法以 `11-跨项目自动化模拟人工测试提效方法论.md` 为长期真源；本文只维护 ProFlow 当前实例的 Gate、版本和实时计时证据。

```text
CodeGraph → structure / ownership / blast radius
Local Dev → Git / current source / Registry / process / tests / batch edit
Playwright Chrome → real Chrome / GPT / Browser UI reality
```

- 多个只读机械检查一次批量采集。
- 长进程启动一次、低频 readback；无输出/Blocked 不等于失败。
- 非幂等动作 UNKNOWN 先恢复 authority。
- 每个有意义 Gate 简短反馈后立即继续，不等待确认。

## 11. 历史 Closeout 允许中断的条件

```text
A. 优化发布 + 完整 latest Fresh Deployment E2E 完成
B. 必须用户本人 OAuth / 2FA / CAPTCHA / secret / 外部授权
C. 必须改变 Frozen Contract / Owner / Architecture
D. 工具明确不可恢复失败
E. 真实上下文硬极限且已安全落盘
```

其它自然阶段、长时间执行、无新 stdout 都不是中断理由。

## 12. 当前唯一续接点

```text
CURRENT_GATE = REAL_3_J0_J4
DEPLOYMENT_TECHNICAL_MAINLINE = PASS
DEPLOYMENT_PRODUCT_ACCEPTANCE = PASS
DEPLOYMENT_SUCCESS = YES
DEPLOYMENT = FROZEN
SOURCE_AT_PRODUCT_ACCEPTANCE = f45a874
SOURCE_VERSION = platform-cli 0.1.50 / dev-tunnel 0.1.25 / browser 0.1.25 / agent-runtime 0.1.13 / role packages 0.1.16
REGISTRY_LATEST = 与上述 Final Freeze 版本机械回读一致
FINAL_FRESH = PASS / 23 of 23 install / real npm only
FINAL_SETUP = 3/3 / public repeat setup recovery / no internal shortcut
FINAL_LIFECYCLE = start → status → repeat setup → repeat status → stop → cold start → final status = PASS
FINAL_STATUS = 3/3 / PLATFORM_READY=YES
USER_ADJUDICATION = PAIRING_TIMEOUT ignore / single port-list failure ignore / single gateway health failure ignore / Registry 112s accepted
NEXT_ACTION = Real-3 J0～J4
DO_NOT_REPEAT = reopen Deployment from historical handoff / rerun Fresh without regression / rebuild 3 GPT / remote Tunnel delete / git push
```

## 13. 2026-09-01 最终 Product Acceptance 裁决

最终真实 latest + Fresh 用户链已经闭环。四项产品门全部 PASS：用户只需标准 platform 命令与不可约信息；Browser/Tunnel/Model/Identity 的可自动化部分均由产品自动完成；CLI 的 setup/status/start/stop 可重入且根阻塞明确；默认输出没有要求用户理解 Tunnel ID、端口、shared facts 或 Start Owner。

本轮最后一次 lifecycle 首次 backstage probe 出现两个**验收脚本断言过时**而非产品故障：Model Runtime `/ready` 本来受 transport credential 保护，匿名请求应 401；Agent Gateway `/ready` 本来就是公开 readiness，因此公网 Tunnel `/ready` 应 200。校准后的最终断言固定为：Model `/health=200` + 带 transport credential 的 `/ready=200`；公网 `/ready=200` + 任意受保护 `/actions/...` 匿名请求 `401/AUTHENTICATION_FAILED`。校准后全部 PASS。

因此：`DEPLOYMENT_SUCCESS=YES`。后续不得用 Deployment Closeout 的名义继续扩范围；业务可用性继续进入 Real-3～Real-6。

历史一次全仓 `pnpm check` 曾因 Browser Extension formatter diff 退出；该历史 hygiene 记录已被后续 release 与 Final Freeze 覆盖，不是当前 blocker。当前仓库封版以本次 affected tests / typecheck / governance / diff-check 的新结果为准。

### 包级 Gate 优先 / 全仓 Gate 仅大阶段

循环测试中的工程回归默认只执行 changed + affected packages：

```text
CodeGraph / 当前源码确认 blast radius
→ pnpm package:gate <changed-package> [affected-package ...]
→ 回真实用户 E2E 原失败场景
```

`pnpm package:gate` 固定执行该包的 `test + typecheck`；若 Package 自己声明 `lint`，才追加该包 lint。**全仓 `pnpm check`、全量 build、architecture、publishability 只在一个大阶段完成时运行，禁止在单 Bug、单包修复、普通整改批次后重复执行。**


### 包级 Release / 完整 E2E 粒度分离

```text
工程 Gate / Release 粒度
= changed + affected packages

真实 Deployment 验收粒度
= 完整不可裁剪 Journey
```

统一包级发布入口只有一个：

```text
pnpm package:release
```

禁止给 `package:release` 传 package list。正常态：脚本调用 `pnpm version -r --dry-run` 获取 pnpm 根据 `.changeset` 计算的完整 release plan；真实执行时再 `pnpm version -r` 消费 intent、同步 package-owned version facts 并提交 release facts，然后只对 release plan 中 Registry MISSING 的包做 selected build/publishability，最终使用 pnpm 原生 `publish -r --filter ...` 发布。恢复态：若 `pnpm change status` 已无 pending intent，则从 `.changeset/ledger.yaml` 最近一次 versioning commit 恢复已经 version、尚未 publish 的 release set。

`pnpm package:release --plan` 是只读入口：展示 changeset/ledger release set，并对这些 exact versions 做 Registry readback；兼容参数 `--dry-run` 仅作为 `--plan` 别名，不执行 mutation。脚本 fail-closed：dirty working tree、非 public release target、version facts drift、Registry UNKNOWN、build/publishability 后产生 tracked dirty state 都拒绝真实 publish；publish timeout/UNKNOWN 后先 exact readback，Registry 已确认成功才允许收口。

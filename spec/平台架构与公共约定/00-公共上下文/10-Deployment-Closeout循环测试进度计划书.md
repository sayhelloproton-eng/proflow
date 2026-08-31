# ProFlow Phase 3｜Deployment Closeout 循环测试进度计划书

> 建立时间：2026-08-30
> 最新整合：2026-08-31
> 性质：滚动执行总控表 / 当前进度真源
> 当前状态：`DEPLOYMENT_TECHNICAL_MAINLINE = PASS`；`DEPLOYMENT_PRODUCT_ACCEPTANCE = PENDING_FINAL_LATEST_SMOKE`；完整 `DEPLOYMENT_SUCCESS = NOT_YET_FINAL`。

## 1. 当前唯一目标

Deployment latest **技术主链**已经通过，不再重开 Fresh 主链全量验收。当前必须用优化后的真实 npm latest 完成最后的产品验收，重点验证四项：**用户心智最低、自动化最大化、CLI 交互好用、默认输出明确**。当前只完成：

```text
O1～O6 优化源码已提交
→ 版本元数据已提交
→ release sync/build/publishability
→ Registry exact preflight
→ publish MISSING exact versions
→ Registry latest readback
→ Product Workspace npm latest upgrade
→ 最小真实 smoke
→ Deployment Closeout 结束
→ 回到 Real-3
```

技术主链已经证明“系统能部署起来”；但最终“部署好”的产品口径进一步冻结为：技术真实可用 + 用户心智最低 + 自动化最大化 + CLI 交互好用 + 默认输出明确。非阻断微小 polish 不推翻技术主链 PASS，但四个产品门未通过前不得写完整 `DEPLOYMENT_SUCCESS=YES`。

## 1.1 循环测试的唯一主视角

**本计划书中的“循环测试”默认且永久指：模拟普通用户真实视角，对 ProFlow Deployment 做真实系统端到端测试，直到完整部署目标成立。**

每一轮都必须从用户真正能接触到的产品面开始：

```text
真实 npm Registry/latest
→ 真实 Product Workspace
→ 公开 platform install / status / setup / start / status
→ 真实 Browser Extension / Dev Tunnel / Model / 3 GPT
→ recovery / repeat / idempotency
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
Latest code/release commit = e3151f7
Current Git HEAD / WorkingTree = 接管时机械重读
DEPLOYMENT_TECHNICAL_MAINLINE = PASS
DEPLOYMENT_PRODUCT_ACCEPTANCE  = PENDING_FINAL_LATEST_SMOKE
DEPLOYMENT_SUCCESS             = NOT_YET_FINAL
Current Gate                   = DEPLOYMENT_OPTIMIZATION_RELEASE_CLOSEOUT
```

Source versions：

```text
@tomflow/proflow-platform-cli                 0.1.48
@tomflow/proflow-dev-tunnel                   0.1.21
@tomflow/proflow-execution-browser-extension  0.1.21
```

最后机械确认 Registry latest：

```text
platform-cli = 0.1.47
dev-tunnel   = 0.1.20
browser      = 0.1.21
```

因此当前禁止把 `0.1.48 / 0.1.21` 描述为已发布；Browser 0.1.21 已存在，禁止重复 publish。

Product Workspace 当前仍是 npm-owned，最后 `platform status`：

```text
配置进度 3/3
Browser = 已完成
Remote  = 已完成
Model   = 已完成
PLATFORM_READY=YES
```

## 3. Deployment latest 技术主链 PASS 证据

| Gate | 状态 | 当前真实证据 |
|---|---|---|
| npm latest / Product install | PASS | 23 个 ProFlow 直接依赖当轮 `npm outdated={}`；真实 Product Workspace npm-owned |
| platform setup | PASS | 3/3 core setup 完成 |
| platform start | PASS | 首次启动成功；repeat start 23/23 skip、0 fail |
| final status | PASS | `PLATFORM_READY=YES` |
| listeners | PASS | `41705/47080/51443/55225/56107` 全部真实 LISTEN |
| Browser 0.1.21 | PASS | Chrome restart/instance drift → fail-closed → setup running-bridge revalidation → evidence 刷新 → READY |
| Dev Tunnel | PASS | owned Tunnel persisted；公网 HTTPS 到达 Gateway auth boundary，返回 401 AUTHENTICATION_FAILED |
| Model | PASS | `/ready` fast/reason READY；FAST 和 THINK 都完成真实 `/infer` |
| 3 GPT carrier | PASS | 三个 Final-Fresh GPT 在真实登录 Chrome 逐个打开，未重建 |
| repeat/idempotency | PASS | repeat setup/start/status 成立 |
| no Fake READY | PASS | Browser instance drift 时先 `PLATFORM_READY=NO`，revalidate 后才恢复 YES |
| Technical mainline | **PASS** | 真实安装/setup/start/status + Browser/Tunnel/Model/3 GPT + recovery/idempotency 已成立 |
| Product acceptance | **PENDING** | 等优化版 npm latest smoke 验证用户心智、自动化、CLI 交互、默认输出四项硬门 |
| DEPLOYMENT_SUCCESS | **NOT_YET_FINAL** | 四项产品门通过后才可最终 YES |

## 3.1 已完成 Recovery / Fail-closed 回归基线

```text
repeat install/setup/start = PASS
stop → start = PASS
Browser disable/reload/revalidation = PASS
Dev Tunnel host-down/same-Tunnel recovery = PASS
Model unreachable fail-closed/recovery = PASS
partial install fail-closed = PASS
package-manager conflict pre-mutation = PASS
running uninstall stops owner/listeners before package removal = PASS
uninstall/reinstall durable identity preservation = PASS
```

发布后 smoke 只重跑与 O1～O6 直接相关的最小路径，不机械重复全部历史 Recovery；只有新版本触及相应 seam 或真实 smoke 出现 regression 才重开。

## 4. Deployment Product Acceptance 四项最终 Gate

最终 npm latest smoke 不能只看 exit code 和 `PLATFORM_READY=YES`，还必须模拟第一次使用 ProFlow 的普通用户，逐项判断：

| Gate | PASS 标准 | 明确 FAIL 信号 |
|---|---|---|
| 用户心智最低 | 用户只理解 install/setup/start/status、当前步骤和必要人类动作 | 要求理解 moduleRef、端口、Tunnel ID、shared facts、owner、provider inventory 等内部实现 |
| 自动化最大化 | machine-owned / producer-owned / 可安全恢复动作全部自动完成 | 重复询问已有事实、要求执行 package CLI、让用户手工恢复机器本可恢复状态 |
| CLI 交互好用 | 明确正在做什么、为什么停、只需做什么、完成后下一步；可重入/取消/恢复 | prompt 含糊、多个动作同时抛给用户、失败后不知道如何继续 |
| 默认输出明确 | 默认聚焦当前状态 + 唯一 root cause + 下一步 + 最终结果 | 23 Module traversal、重复 Registry 核验、错误服务计数、内部诊断噪声淹没用户决策 |

这四项必须通过真实发布后的 Product Workspace smoke 取证，不能仅凭源码 review 或 unit test 宣告 PASS。O1～O6 是本轮对这些 Gate 的直接整改实现。

## 5. O1～O6 优化批次

```text
O1 PASS  install 默认隐藏 Registry package-by-package 核验
O2 PASS  setup 默认隐藏 23 Module traversal / skip
O3 PASS  Dev Tunnel read-only query 45s bounded window；timeout 最多重试一次；mutation 不重试
O4 PASS  删除不可信服务/进程数量默认输出
O5 PASS  uninstall 成功/停止措辞收敛
O6 PASS  默认 CLI 聚焦当前状态 + root cause + 下一步
```

源码验证：

```text
platform-cli tests = 85/85 PASS
platform-cli typecheck = PASS
dev-tunnel tests = 33/33 PASS
dev-tunnel typecheck = PASS
git diff --check = PASS
source CLI against real Product Workspace status/setup UX = PASS
```

提交：

```text
3e91e9b fix(deployment): streamline cli and tunnel recovery ux
e3151f7 chore(release): version deployment ux closeout
```

Version plan 已落盘：

```text
platform-cli 0.1.47 → 0.1.48
dev-tunnel   0.1.20 → 0.1.21
```

## 6. 当前唯一 Next Action

```text
1. release:sync:check
2. build + publishability（按 release transaction，不重新跑无关全仓测试）
3. npm Registry exact preflight：
   - @tomflow/proflow-platform-cli@0.1.48
   - @tomflow/proflow-dev-tunnel@0.1.21
4. 只发布 MISSING exact version
5. exact + dist-tag latest readback
6. Product Workspace npm latest upgrade
7. 最小用户视角 smoke：
   - platform setup
   - platform start
   - platform status = 3/3 / PLATFORM_READY=YES
   - Browser live session 不回归
   - Tunnel HTTPS reality 不回归
   - Model FAST/THINK readiness/真实最小 probe 不回归
   - 3 GPT carrier identity/page 仍存在
8. 更新 02/09/10 最终状态，结束 Deployment Closeout
9. 回到 Real-3 J0～J4
```

## 7. 发布纪律

```text
version → build → publishability → exact preflight → publish MISSING → exact verify
```

- `npm publish` 在当前 Deployment 优化收口授权内；`git push` 不在授权内。
- publish timeout/UNKNOWN → 先 exact readback，禁止盲目重发。
- Browser 0.1.21 已发布，绝不重复 publish。
- 不删除远端 Dev Tunnel。
- 不删除/重建 3 个 GPT。
- 不读取、打印或提交 token/Bearer/API Key/credential。
- Product Workspace npm-owned 时只用 `./node_modules/.bin/platform`，禁止 `pnpm exec platform`。

## 8. 最小 smoke 的 PASS / FAIL

### PASS

```text
Registry latest = platform-cli 0.1.48 + dev-tunnel 0.1.21 + browser 0.1.21
Product Workspace 确认安装上述 latest
platform setup/start/status 正常
PLATFORM_READY=YES
Browser/Tunnel/Model/3 GPT 没有因优化版本回归
默认 CLI 输出符合 O1～O6 目标
```

### FAIL

只在优化版本直接引入新的、可复现 Deployment regression 时进入最小修复；不得因为历史已通过的 Recovery 场景、业务 Real-3 能力或新的纯 polish 想法无限扩大 smoke。

## 9. 验证强度

当前源码已经完成 affected-package tests/typecheck。接下来 release transaction 只做版本同步、build、publishability、Registry preflight/readback 与真实 Product smoke；**没有新源码修改时禁止重新跑整套 `pnpm check` 只为“更放心”。**

若 smoke 暴露新源码 root cause：

```text
真实复现
→ CodeGraph 定位 blast radius
→ Local Dev 当前源码验证
→ 最小 fix
→ targeted/affected regression
→ 原 smoke 重放
→ 必要时新 patch version
```

## 10. 工具与效率规则

```text
CodeGraph → structure / ownership / blast radius
Local Dev → Git / current source / Registry / process / tests / batch edit
Playwright Chrome → real Chrome / GPT / Browser UI reality
```

- 多个只读机械检查一次批量采集。
- 长进程启动一次、低频 readback；无输出/Blocked 不等于失败。
- 非幂等动作 UNKNOWN 先恢复 authority。
- 每个有意义 Gate 简短反馈后立即继续，不等待确认。

## 11. 允许中断的条件

```text
A. 优化发布 + latest smoke 完成
B. 必须用户本人 OAuth / 2FA / CAPTCHA / secret / 外部授权
C. 必须改变 Frozen Contract / Owner / Architecture
D. 工具明确不可恢复失败
E. 真实上下文硬极限且已安全落盘
```

其它自然阶段、长时间执行、无新 stdout 都不是中断理由。

## 12. 当前唯一续接点

```text
CURRENT_GATE   = DEPLOYMENT_OPTIMIZATION_RELEASE_CLOSEOUT
DEPLOYMENT_TECHNICAL_MAINLINE = PASS
DEPLOYMENT_PRODUCT_ACCEPTANCE = PENDING_FINAL_LATEST_SMOKE
DEPLOYMENT_SUCCESS = NOT_YET_FINAL
LATEST_CODE_RELEASE_COMMIT = e3151f7
SOURCE_HEAD/TREE = 接管时机械重读
SOURCE_VERSION = platform-cli 0.1.48 / dev-tunnel 0.1.21 / browser 0.1.21
REGISTRY_LATEST= platform-cli 0.1.47 / dev-tunnel 0.1.20 / browser 0.1.21
PRODUCT_STATUS = 3/3 / PLATFORM_READY=YES（优化前 latest）
NEXT_ACTION    = release sync/build/publishability → exact preflight → publish 0.1.48/0.1.21 → Registry latest → Product latest smoke
DO_NOT_REPEAT  = Browser 0.1.21 publish / 3 GPT rebuild / remote Tunnel delete / git push
```

### 包级 Gate 优先 / 全仓 Gate 仅大阶段

循环测试中的工程回归默认只执行 changed + affected packages：

```text
CodeGraph / 当前源码确认 blast radius
→ pnpm package:gate <changed-package> [affected-package ...]
→ 回真实用户 E2E 原失败场景
```

`pnpm package:gate` 固定执行该包的 `test + typecheck`；若 Package 自己声明 `lint`，才追加该包 lint。**全仓 `pnpm check`、全量 build、architecture、publishability 只在一个大阶段完成时运行，禁止在单 Bug、单包修复、普通整改批次后重复执行。**

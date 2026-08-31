# ProFlow Phase 3｜Deployment Closeout 循环测试进度计划书

> 建立时间：2026-08-30
> 最新整合：2026-08-31
> 性质：滚动执行总控表 / 当前进度真源
> 当前状态：`DEPLOYMENT_TECHNICAL_MAINLINE = PASS`；`DEPLOYMENT_PRODUCT_ACCEPTANCE = PENDING_FINAL_LATEST_SMOKE`；完整 `DEPLOYMENT_SUCCESS = NOT_YET_FINAL`。

## 1. 当前唯一目标

Deployment latest **技术主链**已经通过，但优化版本发布后仍必须从真实 npm latest 重新执行一轮**完整、不可裁剪的 Fresh Deployment E2E**，不能用“最小 smoke”替代部署路径。当前必须完成：

```text
O1～O7 当前已裁决优化源码 / changeset intent 已落盘
→ changed packages 包级 release
→ Registry exact/latest readback
→ 若 platform-cli 变更：升级真实全局 platform-cli latest
→ Fresh Product Workspace
→ 全局 platform install / status / setup
→ Browser Extension / Dev Tunnel / Model / 3 GPT
→ platform start / final status
→ recovery / repeat / idempotency
→ Product Acceptance 四项门
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
Latest deployment code commit = d768615
Latest release machinery commit = e30f9d2
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
@tomflow/proflow-execution-browser-extension  0.1.21（pending patch intent → 0.1.22）
```

最后机械确认 Registry latest：

```text
platform-cli = 0.1.47
dev-tunnel   = 0.1.20
browser      = 0.1.21
```

因此 `platform-cli 0.1.48 / dev-tunnel 0.1.21` 仍是 versioned-but-unpublished；Browser `0.1.21` 是 Registry 已发布基线，但 O7 已新增 patch intent，目标 `0.1.22`，尚未 version / publish。

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
| Browser 0.1.21 | PASS | 真实 Chrome Fresh load → enabled / Service Worker → pairing / live heartbeat → READY |
| Dev Tunnel | PASS | owned Tunnel persisted；公网 HTTPS 到达 Gateway auth boundary，返回 401 AUTHENTICATION_FAILED |
| Model | PASS | `/ready` fast/reason READY；FAST 和 THINK 都完成真实 `/infer` |
| 3 GPT carrier | PASS | 三个 Final-Fresh GPT 在真实登录 Chrome 逐个打开，未重建 |
| repeat/idempotency | PASS | repeat setup/start/status 成立 |
| no Fake READY | PASS | Browser READY 必须来自当前 Fresh load + pairing / live heartbeat + `platform status` 真值，不能只凭历史 evidence |
| Technical mainline | **PASS** | 真实安装/setup/start/status + Browser/Tunnel/Model/3 GPT + recovery/idempotency 已成立 |
| Product acceptance | **PENDING** | 等优化版发布后的完整 latest Fresh Deployment E2E 验证用户心智、自动化、CLI 交互、默认输出四项硬门 |
| DEPLOYMENT_SUCCESS | **NOT_YET_FINAL** | 四项产品门通过后才可最终 YES |

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

历史 Recovery 证据继续作为诊断基线，但**不能替代发布后这一轮完整 Deployment E2E 的 recovery / repeat / idempotency 步骤**。本轮仍按冻结路径完整执行；历史证据只用于避免重新探索测试方法和帮助快速定位 regression。

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
platform-cli tests = 85/85 PASS
platform-cli typecheck = PASS
dev-tunnel tests = 33/33 PASS
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

当前 release state：

```text
platform-cli source 0.1.48 / Registry 0.1.47 / pending patch intent 存在
dev-tunnel   source 0.1.21 / Registry 0.1.20 / versioned-but-unpublished
browser      source 0.1.21 / Registry 0.1.21 / pending patch intent → 0.1.22
```

`pnpm change status` 当前还暴露一个 release preflight 异常：platform-cli 显示 `0.1.48 → 0.1.48 (patch)`。在真正 release 前必须单独恢复 changeset/ledger 权威状态并裁决；当前 O7 不顺手修改 release machinery。

## 5.1 当前 Dev Tunnel 优化裁决前沿

Dev Tunnel 真人模拟 / 自动化复用 SOP 已冻结到 `05-执行纪律与工具规则.md`。当前前台用户只走 `platform setup/status`；CLI resolution、登录状态判断、Tunnel create/reuse、port reconciliation、host、public HTTPS 都由机器处理。唯一可能的人类动作是 `NOT_LOGGED_IN` 后的 GitHub Browser Auth 中不可替代的账号授权 / 2FA / CAPTCHA。

当前只读审计发现三个待逐项裁决候选，尚未改代码：

```text
D1 Fresh ownership：fresh:workspace 删除 .proflow 后会丢失唯一 tunnelId；当前 create 使用随机 ID，可能导致 Fresh replay 再建新 Tunnel。Dev Tunnel CLI 原生支持 deterministic tunnel-id / labels / list --all-labels，应优先基于原生能力恢复 workspace ownership。
D2 create durability：create 已成功返回 tunnelId 后，当前先 show 验证、后持久化。如果 show timeout/UNKNOWN，已创建 tunnelId 没有落盘，下一轮可能再次 create。应先保证 non-idempotent create 的已知结果可恢复，再做远端验证。
D3 redundant/bounded queries：同一 setup 内 ensureLogin 与 host.start 当前可能重复 user show；public URL discovery 又有 3 轮 show × 每轮 timeout retry 的双层 bounded retry。可进一步减少重复查询，但必须在 D1/D2 ownership/UNKNOWN 语义明确后再裁。
```

顺序固定为：**先裁 D1 ownership → D2 create durability → 再裁 D3 查询提效**。禁止为了测试手工输入旧 Tunnel ID、删除远端 Tunnel 或绕过 Platform。

## 6. 当前唯一 Next Action

```text
1. 继续 Deployment 优化逐项裁决；当前先裁 Dev Tunnel D1 Fresh ownership
2. 全部裁决完成后做 release preflight：恢复 pnpm changeset / ledger 权威状态，先解决 platform-cli `0.1.48 → 0.1.48 (patch)` 异常
3. pnpm package:release（不手工传包名；release set 必须来自 pnpm changeset/ledger 真源）
4. Registry exact + dist-tag latest readback
5. 因 platform-cli 本轮变更：npm install -g @tomflow/proflow-platform-cli@latest
6. platform -v 必须等于 Registry latest
7. pnpm fresh:workspace --workspace /Users/agent/Desktop/proton-workspace
8. 使用全局 platform 执行完整 Deployment E2E：
   - platform install --workspace /Users/agent/Desktop/proton-workspace
   - platform status
   - platform setup
   - Browser Extension
   - Dev Tunnel
   - Model Provider / FAST / THINK
   - 3 GPT / Role Identity
   - platform start
   - platform status = 3/3 / PLATFORM_READY=YES
   - recovery / repeat / idempotency
   - Product Acceptance 四项门
9. 更新 02/09/10 最终状态，结束 Deployment Closeout
10. 回到 Real-3 J0～J4
```

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
Registry latest = 全部当前 release plan 目标版本；Browser O7 目标至少包含新的 0.1.22（最终版本以 pnpm release plan 为准）
→ 全局 platform-cli = Registry latest
→ Fresh Product Workspace
→ platform install / initial status / setup
→ Browser / Tunnel / Model / 3 GPT 全部真实验证
→ platform start / final status = PLATFORM_READY=YES
→ recovery / repeat / idempotency 完整执行
→ Product Acceptance 四项门全部 PASS
```

### FAIL

完整 Deployment E2E 任何一步真实失败都保存现场、定位 root、最小修复并回到同一用户路径重放；不得用历史 PASS 省略本轮步骤，也不得把完整 Journey 改成最小 smoke。

## 9. 验证强度

当前源码已经完成 affected-package tests/typecheck。接下来 release transaction 只对发生版本变化的 Package 做 selected version-sync/build/publishability/Registry publish/readback；**没有新源码修改时禁止重新跑整套 `pnpm check` 只为“更放心”**。发布后仍必须重新跑完整 Fresh Deployment E2E；工程 Gate 可以缩范围，Deployment Journey 不可以缩范围。

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
A. 优化发布 + 完整 latest Fresh Deployment E2E 完成
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
LATEST_DEPLOYMENT_CODE_COMMIT = d768615
LATEST_RELEASE_MACHINERY_COMMIT = e30f9d2
SOURCE_HEAD/TREE = 接管时机械重读
SOURCE_VERSION = platform-cli 0.1.48 / dev-tunnel 0.1.21 / browser 0.1.21（pending patch → 0.1.22）
REGISTRY_LATEST= platform-cli 0.1.47 / dev-tunnel 0.1.20 / browser 0.1.21
PRODUCT_STATUS = 3/3 / PLATFORM_READY=YES（优化前 latest）
NEXT_ACTION    = 继续下一项优化裁决 → 全部裁决结束后 release preflight → package:release → Registry latest → global platform-cli latest → Fresh Workspace → 完整 Deployment E2E
RELEASE_PREFLIGHT_BLOCKER = platform-cli pending intent 当前显示 0.1.48 → 0.1.48 (patch)，真正 release 前必须先恢复 changeset/ledger 权威状态
DO_NOT_REPEAT  = Browser 0.1.21 同版本 publish / Browser Reload 或 Disable-Enable 人为测试 / 3 GPT rebuild / remote Tunnel delete / git push
```

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

# ProFlow Phase 3｜Deployment Closeout 循环测试进度计划书

> 建立时间：2026-08-30
> 最新整合：2026-08-31
> 性质：滚动执行总控表 / 当前进度真源
> 当前状态：`DEPLOYMENT_SUCCESS = YES`，主部署链已 PASS；正在完成 O1～O6 优化版本发布与发布后 npm latest smoke。

## 1. 当前唯一目标

Deployment latest 主链已经通过，不再重开 Fresh 主链全量验收。当前只完成：

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

用户最终裁决继续有效：**主部署链真实跑通即可认为部署成功；非阻断 UX/自动化问题属于后置优化。**

## 2. 当前权威现场快照

> 易变化事实接管时必须机械重读。

```text
Source Repo        = /Users/agent/Desktop/proton-workspace/repos/proflow
Product Workspace  = /Users/agent/Desktop/proton-workspace
Source HEAD         = e3151f7
Source WorkingTree  = CLEAN
DEPLOYMENT_SUCCESS  = YES
Current Gate        = DEPLOYMENT_OPTIMIZATION_RELEASE_CLOSEOUT
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

## 3. Deployment latest 主链最终 PASS 证据

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
| DEPLOYMENT_SUCCESS | **YES** | 用户冻结的 Deployment 成功口径已满足 |

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

## 4. O1～O6 优化批次

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

## 5. 当前唯一 Next Action

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

## 6. 发布纪律

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

## 7. 最小 smoke 的 PASS / FAIL

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

## 8. 验证强度

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

## 9. 工具与效率规则

```text
CodeGraph → structure / ownership / blast radius
Local Dev → Git / current source / Registry / process / tests / batch edit
Playwright Chrome → real Chrome / GPT / Browser UI reality
```

- 多个只读机械检查一次批量采集。
- 长进程启动一次、低频 readback；无输出/Blocked 不等于失败。
- 非幂等动作 UNKNOWN 先恢复 authority。
- 每个有意义 Gate 简短反馈后立即继续，不等待确认。

## 10. 允许中断的条件

```text
A. 优化发布 + latest smoke 完成
B. 必须用户本人 OAuth / 2FA / CAPTCHA / secret / 外部授权
C. 必须改变 Frozen Contract / Owner / Architecture
D. 工具明确不可恢复失败
E. 真实上下文硬极限且已安全落盘
```

其它自然阶段、长时间执行、无新 stdout 都不是中断理由。

## 11. 当前唯一续接点

```text
CURRENT_GATE   = DEPLOYMENT_OPTIMIZATION_RELEASE_CLOSEOUT
DEPLOYMENT_SUCCESS = YES
SOURCE_HEAD    = e3151f7
SOURCE_TREE    = CLEAN
SOURCE_VERSION = platform-cli 0.1.48 / dev-tunnel 0.1.21 / browser 0.1.21
REGISTRY_LATEST= platform-cli 0.1.47 / dev-tunnel 0.1.20 / browser 0.1.21
PRODUCT_STATUS = 3/3 / PLATFORM_READY=YES（优化前 latest）
NEXT_ACTION    = release sync/build/publishability → exact preflight → publish 0.1.48/0.1.21 → Registry latest → Product latest smoke
DO_NOT_REPEAT  = Browser 0.1.21 publish / 3 GPT rebuild / remote Tunnel delete / git push
```

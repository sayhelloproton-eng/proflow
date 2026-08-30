# ProFlow Phase 3｜Deployment Closeout 循环测试进度计划书

> 建立时间：2026-08-30
> 性质：滚动执行总控表 / 循环测试计划 / 当前进度真源
> 适用阶段：`CURRENT_EXECUTION_GATE = DEPLOYMENT_CLOSEOUT`
> 最终目标：`DEPLOYMENT_SUCCESS = YES`
> 本文件只滚动更新，不按每轮测试新建副本；历史过程由 Git 保留。

## 1. 这份计划书解决什么问题

本文件不是普通 TODO，也不是工程测试清单。它固定控制下面这个循环，防止执行过程中因为局部测试 PASS、历史 PASS、长上下文或工程 Gate 而丢失真实部署主线：

```text
真实测试
→ 发现问题
→ 定位 root cause
→ 最小修复
→ targeted / affected-package regression
→ 回到原真实场景重放
→ 继续 Journey 下一节点
→ 再发现问题则继续循环
→ 所有验收节点真实 PASS
→ DEPLOYMENT_SUCCESS=YES
```

最高原则：**真实用户 Journey 是主线程；源码测试和工程 Gate 只是修复证据，不能替代现实状态。**
## 2. 当前权威现场快照

```text
Source Repo      = /Users/agent/Desktop/proton-workspace/repos/proflow
Source Branch    = main
Source HEAD      = 80e1d4e
Product Workspace= /Users/agent/Desktop/proton-workspace
Platform CLI     = 0.1.42
Active Modules   = 23
DEPLOYMENT_SUCCESS = NO
```

当前源码 working tree 已知新增未提交内容：

```text
M  05-执行纪律与工具规则.md
?? 10-Deployment-Closeout循环测试进度计划书.md
```

真实产品工作区当前存在本轮 Fresh install 生成的：

```text
M package.json
M pnpm-lock.yaml
M pnpm-workspace.yaml
.proflow/
node_modules/
```

易变化事实接管时必须机械重读；本节快照不能替代实时 Git / Registry / runtime reality。
## 3. 唯一真实 Journey

```text
Registry exact artifacts
→ Fresh Workspace
→ platform bootstrap
→ platform install
→ platform status
→ platform setup
→ Browser Extension
→ Dev Tunnel
→ Model Provider / FAST / THINK
→ platform start
→ platform status
→ stop / restart / recovery
→ repeat / idempotency
→ DEPLOYMENT_SUCCESS=YES
```

禁止跳过前置节点后用下游结果反推 PASS；禁止用历史 evidence 替代当前 Fresh Workspace reality。

## 4. 当前循环总进度

| Gate | 当前状态 | 当前事实 / PASS 条件 |
|---|---|---|
| Registry exact artifacts | PASS | 6 个修正版已正式 publish 并 exact readback |
| Fresh Workspace clean | PASS | 本轮已从受控 clean 状态重新开始 |
| platform bootstrap | PASS | Registry `platform-cli@0.1.42` |
| platform install | PASS | Registry 23/23 preflight + 23/23 Module.install |
| Browser Extension real load | PASS | 真实 Chrome 已加载 `ProFlow Execution Browser 0.1.17`，enabled，Service Worker 可见 |
| Browser pairing / heartbeat | PASS | 真实 pairing 成功；`platform status` 已将浏览器扩展判为已完成；setup retry 未增加 extensions tab |
| Dev Tunnel Fresh setup | PASS_SOURCE_REPLAY / REGISTRY_PENDING | DT-01 已定位并最小修复；真实 setup=READY、重复 setup 同 Tunnel/PID、host-down 同 Tunnel 恢复；修正版尚待批次发布/Fresh Registry 重验 |
| Model Provider / FAST / THINK | BLOCKED_EXTERNAL + DOING_SOURCE | 真实主机可达但 `192.168.0.108:8080` connection refused；Provider PTY 已真实输入 URL 并 fail-closed；新增 owner-local URL retry persistence，待真实 endpoint 恢复后继续 |
| platform start | FAIL_CLOSED_VERIFIED / FINAL_PENDING | Provider 未 READY 时真实 `platform start` RC=1，只显示模型根阻塞；最终成功仍待真实模型就绪 |
| final platform status | NO | 必须真实根状态一致，无 Fake READY |
| recovery / idempotency | DOING | Tunnel repeat setup 同 Tunnel/PID；owned host kill 后 status=FAILED、setup 恢复同 Tunnel/新 PID/RUNNING；Browser live disable/reload 与最终全链重复仍待 full start |
| DEPLOYMENT_SUCCESS | NO | 所有必需 Gate 未全部 PASS |
## 5. 当前 Round

### Round R3｜Fresh Registry 0.1.42 系列真实回放

已完成：

```text
Registry exact readback
→ controlled Fresh clean
→ install platform-cli@0.1.42
→ platform install
→ 23/23 PASS
→ platform status
→ 当前 root prerequisite = Browser Extension
```

Browser Extension 当前结果：

```text
BE-01 PASS 真实 Chrome 已加载产品扩展、enabled、Service Worker 可见
BE-02 PASS Step 2 不再重复 open chrome://extensions
BE-03 PASS developer-mode 确认由 owner-local install-flow state 记忆；setup retry extensions tab 2 → 2
PAIRING PASS 真实 pairing/heartbeat 成功；platform status = 浏览器扩展已完成
```

Dev Tunnel 当前结果：

```text
DT-01 ROOT = `devtunnel --version` 会访问远端 service metadata，真实耗时约 6～9s 且可越过旧 10s timeout；resolver 把 timeout 当 unknown 后错误进入 managed-download fallback。
FIX = devtunnel-cli version probe timeout 10s → 30s（与远端 CLI 操作的现实延迟匹配）。
REGRESSION = devtunnel-cli 2/2 PASS + typecheck PASS + 真实 resolver 返回 system 1.0.2030。
AUTH = Fresh 时 token 已过期；GitHub browser auth 自动完成，无需用户介入。
REAL REPLAY = source owner setup → READY；platform status → 远程连接已完成。
IDEMPOTENCY = repeat setup 保持 sameTunnel=true / samePid=true。
RECOVERY = owned host kill → status runtime FAILED → setup 恢复 sameTunnel=true / pidChanged=true / RUNNING。
```

当前正在处理：**Model Provider / FAST / THINK**。

当前真实前沿：

```text
MODEL-EXT-01 host 192.168.0.108 ping reachable
             port 8080 = connection refused
             /v1/models 不可达

MP-01 platform setup PTY 已接受真实 Base URL
      owner probe = UNREACHABLE / fail-closed
      platform start = RC1 / PLATFORM_READY=NO

MP-02 新发现恢复 UX：首次 URL 不可达时旧实现不保存 URL，retry 又退回“尚未绑定”，迫使用户重复输入。
      FIX = 仅把非敏感 endpoint binding 持久化为 owner config；READY 仍必须真实 inventory probe，绝不发布假 shared facts。
      REGRESSION = model-provider-api 19/19 PASS + typecheck PASS；新增“unreachable → status retry → service recovery without re-enter URL”证明。
```

Browser / devtunnel-cli / model-provider-api 源码修复统一留到同一整改批次发布；禁止逐 Bug 发版。真实模型 endpoint 恢复前继续完成不依赖它的 recovery/idempotency 与批次收口，最终 Fresh Registry replay 必须重新用真实 endpoint。

本整改批次 L3 已完成：

```text
Test Governance = PASS（632 executable test calls）
Surface Governance = PASS
Build = PASS
Lint = PASS
Typecheck = PASS
Tests = 632/632 PASS
Architecture / Deployment Graph = PASS
Publishability = PASS
Git diff --check = PASS
```

当前 release plan 已冻结为：

```text
@tomflow/proflow-devtunnel-cli              0.1.0  → 0.1.1
@tomflow/proflow-execution-browser-extension 0.1.17 → 0.1.18
@tomflow/proflow-model-provider-api          0.1.16 → 0.1.17
```

下一步只进入一次 version/build/publishability/publish/Registry exact verify，不再重跑本批全仓测试。

## 6. 每个问题的固定循环

```text
1. 在真实 Journey 中复现并记录 evidence
2. 判断 root owner / blast radius
3. 只读定位 root cause
4. 在已授权 Deployment 范围内做最小修复
5. 只跑 targeted test / affected package test
6. 回到同一个真实失败场景重放
7. 原场景 PASS 后立即继续 Journey 下一节点
8. 不因局部修复触发全仓 Gate
```
## 7. 验证强度分级

### L1｜局部 root 修复

只允许：

```text
targeted test
必要时 affected package test
typecheck 仅在类型边界受影响时
精确 reverse verify
原真实场景重放
```

**禁止**因为一个局部问题修复就执行 `pnpm check` 全仓 Gate。

### L2｜一个整改批次完成

当同一轮已冻结 roots 全部处理完：

```text
affected packages tests
changed-files lint/format check
git diff --check
必要的 architecture/surface/governance 局部检查
```

### L3｜release / 阶段收口

仅在准备正式发布或 Deployment 最终收口时统一执行一次：

```text
pnpm check
build
architecture
publishability
release sync
```
## 8. Browser Extension 专项 PASS 条件

Browser Extension 只有同时满足下列事实才允许从 DOING 改为 PASS：

```text
1. Fresh Workspace 扩展安装物存在
2. 真实 Chrome 中产品扩展已加载
3. 产品扩展 enabled
4. extension runtime / service worker 可观察
5. pairing 成功
6. live heartbeat 成立
7. platform status 读取到当前真实 READY
8. disable/unload 后不能继续 Fake READY
9. reload/restart 后可恢复 live session
10. setup 重入不重复制造 chrome://extensions tab
```

Playwright MCP 自身连接扩展不等于 ProFlow Browser Extension；二者必须分开识别。

当前 Browser residual：

```text
BE-01 PASS real load / enabled / Service Worker 已真实确认
BE-02 PASS Step 2 不再重复 open chrome://extensions
BE-03 PASS setup retry 已保持 extensions tab 数不增长
```

Browser 已完成本轮真实重放；当前 Journey 已推进到 Dev Tunnel。后续除 recovery/idempotency 专项外，不得重新把 Browser 当当前 blocker，也不得因此触发全仓 Gate。
## 9. Dev Tunnel 专项 PASS 条件

Dev Tunnel 本轮 Fresh PASS 必须满足：

```text
1. auth 状态按 JSON 真值判断，不信 exit code
2. 已登录时不重复发起 OAuth
3. 优先复用 workspace-owned tunnel，不盲目创建
4. consume agent-gateway.localBaseUrl
5. port reconcile 正确
6. host 真实运行
7. 从当前 port 获取 HTTPS URL
8. TLS / HTTPS probe 成功
9. 原子持久化 tunnelId/publicBaseUrl
10. platform status 显示真实 READY
11. status 不做昂贵 auth shell probe
12. stop/restart 后状态恢复正确
```

禁止为了幂等测试删除远端 Tunnel；禁止 UNKNOWN 后盲目重跑 mutation setup。

## 10. Model Provider / Runtime 专项 PASS 条件

真实 endpoint 固定：

```text
http://192.168.0.108:8080/v1
```

Provider 只负责 URL / auth / inventory truth；Runtime 负责 FAST / THINK / Vision / thinking capability verification。
Model PASS 必须满足：

```text
1. Provider URL 可达并完成真实 inventory probe
2. auth-required 时只请求真实 credential，不伪 READY
3. Runtime 对候选做真实 capability probe
4. FAST / THINK 只从合格候选产生
5. ambiguity 才要求用户选择
6. 不合格原因可诊断并持久化
7. mapping 与当前 inventory fingerprint 一致
8. inventory drift 后 stale/remap 语义正确
9. platform status 能恢复真实 FAILED / ACTION_REQUIRED
10. start 只在真实配置 READY 后继续
```

若 endpoint 暂时不可达：记录为外部 blocker，能继续的其它部署测试继续；最终宣布 Deployment PASS 前必须按部署合同确认是否仍是不可约阻塞。

## 11. 最终 recovery / idempotency 场景

正常主路径通过后，至少覆盖：

```text
重复 platform install
重复 platform setup
重复 platform start
platform stop → start
Browser disable/unload → stale/not-ready → reload recovery
Dev Tunnel owned host down → recovery
Model endpoint unreachable → fail-closed → recovery
partial install → status INCOMPLETE / setup-start fail-closed
package-manager conflict → mutation 前失败
uninstall → reinstall
最终再次 Fresh replay
```

这些测试用于证明稳定性，不允许通过删除不归当前测试拥有的远端资源制造场景。
## 12. Release 循环纪律

只有一个整改批次需要真实 Registry 安装物验证时才进入 release：

```text
冻结本批变更
→ L3 全仓 Gate 一次
→ version
→ build
→ publishability
→ commit version/release metadata
→ Registry exact preflight
→ 只发布 MISSING package@version
→ Registry exact verify
→ controlled Fresh clean
→ Registry Fresh replay
```

publish timeout / UNKNOWN 时先 exact readback，禁止盲目重发。`npm publish` 已获 Deployment Closeout 授权；`git push` 未授权。

## 13. Round 记录模板

每轮只维护一条滚动记录：

```text
Round: R<n>
Start Gate: <从哪个真实节点开始>
Target: <本轮要推进到哪里>
Observed Failures: <实际失败>
Frozen Roots: <归并后的 root>
Changes: <最小修改范围>
Regression: <targeted/package 结果>
Replay: <原场景真实结果>
End Gate: <推进后的节点>
Remaining: <未完成项>
Next Entry: <下一次必须从这里继续>
```

局部测试 PASS 只能写入 `Regression`，不能直接修改 Journey Gate。
## 14. 中断与汇报条件

正常循环不因局部 PASS、长命令完成、发现普通 Bug、完成一次发布、自然阶段切换或累计执行时间较长而停下来汇报。**循环总时长没有 25 分钟、30 分钟或其它人为上限；“不要做长任务”只限制单次不可恢复工具任务，不限制整个 Chat 连续执行多个短批次。**

只允许以下情况主动中断执行：

```text
A. DEPLOYMENT_SUCCESS=YES
B. 必须本人完成的 OAuth / 2FA / CAPTCHA / secret / 外部授权
C. 需要改变 Frozen Contract / Owner / Architecture
D. 工具明确不可恢复失败
E. 上下文确有硬极限且必须立即安全交接
```

D/E 必须有真实工具/上下文事实支持，禁止因为“已经跑了很久”“大约二三十分钟”“担心后面可能卡死”而自行宣判 hard limit。

### 14.1 目标保全判定门

每个短批次结束时，不允许由模型自行判断“是否该休息/收口”，只执行下面的机械判定：

```text
DEPLOYMENT_SUCCESS == YES
→ 最终汇报并停止

否则，如果存在 B/C/D/E 中已被事实证明的 hard blocker
→ 保存最小断点并按 blocker 规则中断

否则
→ 必须立即继续 NEXT_ACTION
```

因此以下内容一律不是中断信号：

```text
执行了很多工具调用
当前 turn 已经很长
上下文看起来越来越大
某个自然阶段刚结束
已经连续工作几十分钟
模型预测“再继续可能失败”
```

**工具还能正常调用就是继续执行的正向证据。** 在没有明确 hard-limit/error 事实时，禁止把风险猜测描述成“系统强制截断”“工具执行上限”或“上下文限制”。本计划书的存在就是为了让长流程通过短批次 + 落盘断点持续推进，而不是为了给主动停工提供理由。

短批次之间固定：`必要的进度表落盘 → 立即进入下一短批次`，不得把短批次边界误当成停止点，也不得因此制造 Git/checkpoint 保全包。其余情况：记录 → 继续循环。

## 15. 最终完成判定

只有下面全部成立才允许：

```text
Registry exact artifacts = PASS
Fresh install = PASS
Browser Extension real reality = PASS
Dev Tunnel real reality = PASS
Model deployment reality = PASS 或按冻结部署合同得到明确合法裁决
platform start = PASS
final status = PASS
recovery = PASS
idempotency = PASS
no Fake READY / Fake SUCCESS
CLI 产品交互满足一次一个 root prerequisite
```

然后才写：

```text
DEPLOYMENT_SUCCESS=YES
```

在此之前任何“代码全绿”“23/23 install”“historical PASS”都不得宣布完成。

## 16. 当前唯一续接点

```text
CURRENT_ROUND = R3
CURRENT_GATE  = Release batch → Model Provider / FAST / THINK → final recovery/Fresh
CURRENT_ROOTS = release-batch(Browser/DT resolver/Provider) + MODEL-EXT-01
CURRENT_BLOCK = MODEL-EXT-01: 192.168.0.108 reachable, TCP/8080 connection refused
NEXT_ACTION   = commit frozen source batch → release:version → canonical build/publishability/publish → Registry exact verify →继续真实 endpoint / final Fresh
VERIFY_LEVEL  = L3 已 PASS（632/632）；发布后禁止重复跑 source full gate
REPLAY        = real endpoint `/v1/models` → Provider READY → Runtime FAST/THINK → platform start/status → Browser live recovery → final Fresh
FULL_GATE     = PASS；除非发布/Fresh replay 再发现新的源码 root，否则不重跑
CONTINUATION  = 短批次间直接续跑；仅最终真实 endpoint 成为唯一不可约 blocker 时才请求用户介入
DEPLOYMENT_SUCCESS = NO
```

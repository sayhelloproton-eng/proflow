# ProFlow Phase 3｜Deployment Closeout 循环测试进度计划书

> 建立时间：2026-08-30
> 性质：滚动执行总控表 / 循环测试计划 / 当前进度真源
> 适用阶段：`CURRENT_EXECUTION_GATE = DEPLOYMENT_CLOSEOUT`
> 最终目标：`DEPLOYMENT_SUCCESS = YES`
> 最新部署裁决：**Custom GPT / 智能体真实创建属于 Deployment，并且是最终 PASS 必要条件。** 历史 Real-2 PASS 不得替代本轮 Fresh Registry 创建验收。
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

> 更新时间：2026-08-30 23:40 左右；易变化事实仍需下一 Chat 机械重读。

```text
Source Repo       = /Users/agent/Desktop/proton-workspace/repos/proflow
Source Branch     = main
Source HEAD       = b874a42
Source WorkingTree= CLEAN
Product Workspace = /Users/agent/Desktop/proton-workspace
Current Product Gate = Final Registry-only Fresh / Browser
DEPLOYMENT_SUCCESS = NO
```

当前 Product Workspace 关键安装物：

```text
platform-cli                 0.1.43
agent-runtime                0.1.11
execution-browser-extension  0.1.18
dev-tunnel                   0.1.20
model-provider-api           0.1.17
model-runtime                0.1.20
agent-gateway                0.1.15
agent-controller-dev         0.1.15
agent-product                0.1.15
agent-test-ops               0.1.15
```

Registry exact readback：

```text
agent-runtime@0.1.11 = PASS（npm pack exact tarball，确认 dist owner-store fix）
platform-cli@0.1.43  = PASS（npm pack exact tarball，确认 dist temporary runtime bootstrap fix）
model-runtime@0.1.20 = PASS（前一轮 exact tarball）
```

当前 public `platform status`：

```text
23 Module status readback
配置进度 0/3
Browser = CURRENT
Remote  = LATER
Model   = LATER
0 real service processes
PLATFORM_READY=NO
```

当前 Agent local durable truth：

```text
roles.json = MISSING
credential store = PRESENT / 0 keys
```

因此上一轮 SOURCE_REAL 创建的 3 个 GPT 不能替代最终 Fresh Gate；当前必须重新走 Registry-only Final Fresh。

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
→ Custom GPT / 智能体真实创建与 identity/config/evidence 闭环
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
| Registry exact artifacts | PASS | `model-runtime@0.1.20`、`agent-runtime@0.1.11`、`platform-cli@0.1.43` 均已 exact tarball readback；后两包确认 dist 含本轮死锁修复 |
| Source fixes / affected regression | PASS | Model Runtime 65/65；Agent Runtime 26/26；Platform CLI 80/80；相关 typecheck/diff-check PASS |
| Final Fresh Workspace baseline | DOING | 当前 Workspace 已安装新 Registry 版本且 `platform status=0/3` fail-closed；下一 Chat 先确认其来源/Chrome registration，必要时才再 controlled clean |
| Browser Extension final Fresh | PENDING | 必须 Remove 旧产品 registration → 当前 Fresh 0.1.18 Load unpacked → enabled/Service Worker → pairing/live heartbeat → status READY |
| Dev Tunnel final Fresh | PENDING | 当前最终轮尚未重验；不删除远端资源，按 owned reuse/create/host/HTTPS probe/READY |
| Model Provider / FAST / THINK final Fresh | PENDING | endpoint 固定 `http://192.168.0.108:8080/v1`；Provider inventory + Runtime FAST/THINK 必须由 0.1.20 Registry 安装物再次证明 |
| Custom GPT / 智能体 final Fresh 创建 | PENDING | **Deployment 必要 Gate**；必须重新创建 3 个角色并验证 ChatGPT 页面 + roles + credential refs + Gateway health/Bearer probe；SOURCE_REAL 历史不能顶替 |
| platform start | PENDING | 只有 final Fresh setup 全 READY 后才执行正式 start |
| final platform status | PENDING | 必须根状态一致、真实 runtime RUNNING、无 Fake READY |
| recovery / idempotency | PENDING | repeat setup/start、stop→start、Browser disable/reload、Tunnel host-down、Model fail-closed/recovery |
| DEPLOYMENT_SUCCESS | NO | 所有必要 Gate 尚未全部 PASS |

### 本 Chat 已新增的 SOURCE_REAL 证明

```text
Model Runtime 0.1.20 source lifecycle = PASS
Agent owner-store + Platform temporary dependency bootstrap = SOURCE_REAL PASS
3 个真实 Custom GPT 串行创建 = SOURCE_REAL PASS
真实 Chrome 页面标题验证 3/3 = PASS
临时 runtime cleanup 后 4 个 service = STOPPED
```

这些证明修复方向成立，但最终完成条件仍是**当前 Registry 安装物的 Final Fresh replay**。

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
2. 真实 Chrome 中上一轮产品扩展 registration 已先 Remove/卸载，不能复用旧 unpacked registration
3. 从当前 Fresh Workspace 安装目录重新执行“加载未打包的扩展程序”，Reload 不算 Fresh install
4. 真实 Chrome 中新产品扩展版本与当前 Registry/Fresh 安装物一致
5. 产品扩展 enabled
6. extension runtime / service worker 可观察
7. pairing 成功
8. live heartbeat 成立
9. platform status 读取到当前真实 READY
10. disable/unload 后不能继续 Fake READY
11. reload/restart 后可恢复 live session（此时 Reload 只作为 recovery 证据）
12. setup 重入不重复制造 chrome://extensions tab
```

Playwright MCP 自身连接扩展不等于 ProFlow Browser Extension；二者必须分开识别。

`chrome://extensions` 与 Chrome/macOS 原生确认框、目录选择器属于系统 UI 边界：Playwright DOM 不足以完成或证明这些动作。Fresh Browser replay 固定使用 `截图/真实 Chrome → macOS AX 定位实时 bounds → 系统级鼠标/键盘操作 → AX + 截图复核`。删除旧扩展时，确认框消失本身不算 PASS，必须继续证明目标扩展 heading/card/registration 已消失；加载新扩展时，必须证明新版本卡片出现、enabled、Service Worker 可见后才进入 pairing。

Fresh Browser 的 Chrome 外部状态清理固定采用 macOS 系统级 AX + CGEvent 路径，不靠固定坐标：先用 AX 按 `AXHeading=ProFlow Execution Browser` 定位产品卡和“移除”按钮 bounds；系统鼠标点击后，立即在同一保持 Chrome 前台的原子进程内定位 `AXWindow=要删除“ProFlow Execution Browser”吗？` 与确认 `AXButton/description=移除`，再用 CGEvent 点击其当前 bounds 中心；最后以 AX heading 消失 + `chrome://extensions` 截图双证据判定旧 registration 已清除。确认浮层在 Chrome 失焦时会消失，因此禁止跨多个工具调用保存旧坐标后再点。

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

**最新规则：正常循环必须逐步实时反馈，但反馈不等于中断。** 每完成一个有意义的用户可感知步骤，立即反馈“动作 / PASS-FAIL-DOING / 关键事实 / 下一步”，然后直接继续；不得为了反馈等待用户确认，也不得因为局部 PASS、长命令完成、发现普通 Bug、完成一次发布、自然阶段切换或累计执行时间较长而停止执行。**循环总时长没有 25 分钟、30 分钟或其它人为上限；“不要做长任务”只限制单次不可恢复工具任务，不限制整个 Chat 连续执行多个短批次。**

**“逐步反馈”不能破坏“批量优先”。** 同一已确认事实同步多份文档、同一批只读状态采集、同一 harness 内多个底层动作，均应作为一个有意义步骤批量完成后反馈一次。固定文档同步路径：`一次搜索全部目标 → 变更矩阵 → 一次批量修改 → 一次统一校验 → 一次反馈`；禁止逐文件串行修改并把每个文件更新伪装成独立进度。

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
后台进程仍在运行但暂时没有新输出
session 显示 Blocked=true
连续读回为 (No output in requested range)
长进程运行了几分钟仍未完成
```

遇到上述长进程状态时，固定执行：`降低 poll 频率 → 查 session/PID/子进程/CPU/文件或外部权威状态 → 仍 active 就继续等待 → UNKNOWN 就恢复权威状态`。**不得把 `Blocked=true`、无新输出或长时间运行解释为工具硬截止，也不得因此结束 Chat。**

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
Custom GPT / 智能体 Fresh 创建 = PASS
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
CURRENT_ROUND = R4 / FINAL_REGISTRY_FRESH
CURRENT_GATE  = Browser Fresh → Tunnel → Model → 3 Custom GPT → start/status → recovery
CURRENT_ROOTS = 当前无新的已确认源码 root；先完成 Registry-only Final Fresh Journey
CURRENT_BLOCK = NONE
SOURCE_HEAD   = b874a42
SOURCE_TREE   = CLEAN
REGISTRY      = agent-runtime 0.1.11 / platform-cli 0.1.43 / model-runtime 0.1.20 exact PASS
PRODUCT_STATE = 23 modules installed; platform status 0/3; Browser current; 0 services; roles.json missing; credential keys=0
NEXT_ACTION   = 机械确认当前 Workspace Fresh 来源 + Chrome 产品 registration；若 Fresh 可证明则直接完成 Browser Remove→Load→Pairing，否则先 controlled clean/public install，再进入 Browser
DO_NOT_REPEAT = 不再 publish 0.1.11/0.1.43；不重开 MR-01/02/03；不重跑 26/80 tests，除非新源码变化；不拿 SOURCE_REAL 3 GPT 顶替 Final Fresh
PACKAGE_MGR   = Product Workspace npm-owned 时禁止 pnpm exec platform；只用本地 platform bin
REPORTING     = 每个有意义 Gate 实时反馈后立即继续，不等待确认
DEPLOYMENT_SUCCESS = NO
```

最终剩余链：

```text
Registry exact PASS（已完成）
→ Final controlled Fresh
→ Browser 0.1.18 real Fresh
→ Dev Tunnel real Fresh
→ Model Provider + Runtime 0.1.20 real Fresh
→ 3 Custom GPT real Fresh
→ platform start
→ platform status READY
→ stop/start + Browser/Tunnel/Model recovery + repeat/idempotency
→ final evidence
→ DEPLOYMENT_SUCCESS=YES
```

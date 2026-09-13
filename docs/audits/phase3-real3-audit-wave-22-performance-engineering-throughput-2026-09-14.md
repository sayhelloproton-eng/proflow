# Phase 3 / Real-3 Audit｜Wave 22｜Performance / Engineering Throughput

日期：2026-09-14
状态：PASS

## Scope

本 Wave 只审计 Real-3 长期阻塞暴露出的性能与工程吞吐问题：loopback round trip、重复扫描/decision、Observer 噪音、timeout、release amplification、模块耦合与多余等待。

本 Wave 不以“减少层数”为目标。只有在机械证据证明某个 boundary 是可避免成本、且移除后不会破坏 ownership / Effect Gate / auth / UNKNOWN reconciliation 时，才允许优化。

执行基线为 Wave 21 已 current-adopted 的最终 runtime：

```text
Gateway = 0.1.19
Product = 0.1.19
Browser Extension = 0.1.64
Platform Host = 0.1.30
Task Orchestration = 0.1.12
PLATFORM_READY = YES
Real-3 Task = SUCCEEDED v11 / currentNodeId=null
```

## Static Evidence

### Host reconciliation is bounded, not a free-running full scan

`packages/platform-host/src/reconciliation-coordinator.ts` current owner：

```text
intervalMs default = 10_000
pageSize default = 100
concurrency default = 4
maxPendingTasks default = 1_024
maxPendingSignals default = 4_096
failure backoff = 500ms exponential, capped at 30_000ms
applied-intent cache per Task = bounded to 128
execution signals per sweep = bounded to 100
sweep = single-flight
task reconcile = per-task single-flight
Task scan = stable keyset cursor
```

失败/blocked signal 有 bounded retry，terminal Task 会立即 clear pending signals / applied cache / failures 并停止 drive。

### Browser observation is event-driven and coalesced

`page-observation-scheduler.ts` 使用 `MutationObserver` 覆盖 subtree / childList / attributes / characterData，但 publish 不是每次 mutation 都执行：

```text
default coalescing delay = 100ms
single pending publish = true
mutation burst while pending = suppressed
```

Permission watchdog：

```text
interval = 10_000ms
bottom-button scan limit = 24
```

因此 watchdog 不是高频全 DOM 扫描。

### Browser reality logging suppresses unchanged state

`operation-observer.ts` 的 `pageTransition()` 只有在以下至少一个轴变化时 emit：

```text
contentInstanceId
pageState
activityKind
permission blocker fingerprint
```

unchanged reality 直接 return，不写重复 `PAGE_REALITY_TRANSITION`。

Extension logger 另外有 bounded outbox：默认最多 1000 events，同时受 1MB / 7天限制；flush single-flight，sink 不可用时保留 bounded local evidence 而不是无界重放。

### Vision fallback has a hard timeout and abort boundary

`execution-runtime/src/browser-vision-client.ts`：

```text
model inference timeout = 12_000ms default
HTTP abort = AbortSignal.timeout(timeoutMs + 1_000)
DOM/runtime deterministic observation remains primary
Vision failure = typed DEFERRED, never fabricated success
```

因此 Vision fallback 不存在无限等待。

### Loopback boundaries are intentional ownership boundaries

当前 Browser Reality、Local Tool、Provisioning 均使用 authenticated loopback HTTP，但三条 lane 的 ownership 不同：

- Browser Reality：真实 Browser state / command；
- Local Tool：Repomix / Local Dev / CodeGraph provider child，读并发、effect 独占，timeout 后保留 UNKNOWN 语义；
- Provisioning：Custom GPT 编辑器命令与文件 relay。

将三条 lane 为了“少一次 HTTP”合并，会破坏 credential isolation、Effect Gate、deadline/replay 语义和独立 lifecycle；当前没有证据支持“内部 HTTP 必须归零”。

## Current Runtime Dynamic Evidence

取 final Platform start/adoption 后 fresh 窗口：

```text
window start = 2026-09-13T20:34:00Z
observed span ≈ 621s
structured events = 104
Platform Host events = 76
Browser Extension events = 25
Gateway events/lifecycle = 3
```

### Reconciliation cadence / cost

Platform Host `listExecutionObserverSignals`：

```text
SUCCEEDED = 60
FAILED = 3
cadence ≈ 10s，和 source default 一致
execution-phase duration p50 ≈ 6.36ms
execution-phase duration p95 ≈ 9.88ms
execution-phase max ≈ 61.02ms
```

结论：10s reconciliation sweep 的 current runtime 成本是毫秒级，不是 Real-3 曾出现 120s / 232s / 344s 级等待的主因。把 interval 改到 1s 只会放大扫描与日志成本，没有当前收益证据。

### Browser / Observer dynamic shape

fresh Browser window：

```text
PAGE_REALITY_TRANSITION = 2
BROWSER_SESSION OFFLINE = 5
BROWSER_SESSION ONLINE = 1
LOCAL_TOOL_SESSION ONLINE = 1
PROVISIONING_COMMAND SUCCEEDED = 1
```

5 次 OFFLINE 发生在本轮 stop/start/reload/re-pair lifecycle 窗口，随后 current session ONLINE；不是 steady-state heartbeat flood。

Observer boundary 的实际 durations：

```text
collaboration.listPending = ~1.91s, later ~0.30s
task.reconcileAll = ~1.30s, later ~0.96s
system.view = ~0.80s / ~1.55s, later ~0.95s / ~0.95s
system.reason = failed ~1.0s and ~31.7s
```

最终 Product provisioning 的 `FINALIZE_CUSTOM_GPT_AUTH` 真实 Browser command约 `23.2s` 并成功。

### Long-tail attribution

当前分钟级风险不在 Host 10s sweep：

- 最长 `system.reason` ~31.7s，属于 System Observer 的模型/推理长尾；
- Product provisioning ~23.2s，属于低频外部 ChatGPT GPT 编辑器操作；
- Host execution scan p95 仍约 10ms。

现有 regression 已证明 pending System assessment 不会阻塞后续 Collaboration recovery；System Observer 是低优先级辅助观察，不拥有 Task progression。因此不能为了消除它的单次长尾把 Host reconciliation/Browser ownership 合并或缩短周期。

## Engineering Throughput

本阶段另确认一类与产品 runtime 无关、但会直接拉长 Chat 用户墙钟的工程吞吐问题：同步等待 npm publish/release。

共享 Engineering Skill 已在本轮提升为 HARD RULE：

```text
npm publish/release = absolute non-blocking
start exactly once detached/durable
record PID/session + log + exact package@version
immediately continue independent work
no synchronous process wait / PID polling / fixed-interval Registry polling
later dependency point → exact npm view authority first
retry only after proven NOT_APPLIED / FAILED
```

Browser `0.1.64` 发布已按该新路径真实执行：发布启动后继续完成 W21 runtime preparation；真正到 install dependency point 才查询 Registry exact，最终 `npm view` 返回 `0.1.64`。

这关闭了“模型等 publish 结果把 Chat 卡死”的已知工程吞吐反例。

## Findings

### W22-F01｜PASS｜Host reconciliation 不是主要 latency owner

current source 与 fresh runtime 均证明 reconciliation 有界、single-flight、毫秒级；无证据支持提高扫描频率或移除 durable reconciliation。

### W22-F02｜PASS｜Browser observation / watchdog 已有 bounded noise control

Mutation burst 100ms coalescing、10s bounded permission watchdog、unchanged page reality suppression 均存在 production owner；fresh runtime 没有 page transition 日志洪水。

### W22-F03｜PASS｜内部 loopback 是安全/ownership 边界，不做无证据合并

Browser、Local Tool、Provisioning lane 的认证、effect/replay、lifecycle 不同。当前 round trip 成本未被证明是关键瓶颈，保留分层。

### W22-F04｜PASS_WITH_RESIDUAL｜模型/System Observer 与外部 GPT provisioning 存在长尾

`system.reason` 单次可到约 31.7s，GPT provisioning约 23.2s。两者当前不是 Task progression 的 blocking critical path；本 Wave 不做 speculative timeout/ownership rewrite。

### W22-F05｜PASS｜Vision fallback timeout / abort 已有硬边界

默认 12s inference + 13s HTTP abort，失败 typed defer；不存在无界 Vision hang。

### W22-F06｜PASS｜release amplification 的 Chat 墙钟反例已由 Shared Skill 治理

npm publish/release 改为绝对非阻塞；Registry exact 是副作用 authority。该改动属于 Chat-only shared engineering protocol，不改变 ProFlow 产品 runtime。

## Changes Applied

ProFlow 产品源码：**NONE**。

原因：当前没有机械证据证明 interval、loopback、Observer 或 timeout 需要产品代码修改；为了性能而删除 ownership boundary 会增加正确性风险。

共享 Chat Engineering Skill：已增加 npm publish/release absolute non-blocking HARD RULE，并同步 machine-readable execution policy / long-task reference。

## Verification

- Wave21 final runtime adoption：`PLATFORM_READY=YES`；
- Browser Extension 0.1.64：same-registration loaded + `PAIRING_HEARTBEAT` + `serviceWorker=RUNNING`；
- Product Role：same roleRef 原地 adopt 0.1.19；
- Real-3 Task owner：`SUCCEEDED v11 / currentNodeId=null`；
- Extension 0.1.64 release gate：build/typecheck PASS，package tests 211/211 PASS，publishability PASS；
- Wave22 static owners：Host coordinator / Browser scheduler/watchdog/logger / Vision client；
- Wave22 dynamic evidence：fresh Host/Browser/Gateway structured log aggregate。

## Residual / Monitoring Boundary

保留两个非 blocker residual：

1. `system.reason` / Model infer 可能出现 30s 级长尾；只有当后续 evidence 证明它阻塞业务 critical path 或频率显著上升时，才进入新的性能 Decision。
2. Custom GPT provisioning 是低频外部 Browser workflow，可有 20s+ 延迟；不得把这种外部 UI latency 转嫁为内部无界 retry 或重复 provisioning。

未来性能优化必须以真实 p50/p95、调用频率和 critical-path blocking proof 为触发条件，不以“层多”“HTTP 多”作为单独改造理由。

## Gate Verdict

```text
WAVE22_STATIC_AUDIT = PASS
WAVE22_CURRENT_RUNTIME_EVIDENCE = PASS
PERFORMANCE_BLOCKER = NO
ENGINEERING_THROUGHPUT_POLICY = PASS
WAVE22 = PASS
WAVE01_TO_22 = PASS
REAL_3 = PASS / CLOSED
PHASE3_FINAL_GO = YES
```

## Final Boundary

Phase 3 / Real-3 已完成。后续若进入新的产品阶段、性能专项或部署迭代，应以新的 objective / acceptance 开始；不得继续把 Wave01–22 已关闭项作为默认 TODO，也不得为刷新证据新建 Real-3 Task/Worker/Conversation。

# 下一个 Chat 提示词｜Real-3 J4 Integration Hardening 诊断续接｜2026-09-07

项目：ProFlow Phase 3
仓库：`/Users/agent/Desktop/proton-workspace/repos/proflow`
真实 Product Workspace：`/Users/agent/Desktop/proton-workspace`

你是 Phase 3 / Real-3 总控。当前不是普通开发，也不是继续 patch 的授权；你的第一职责是用最短证据链把 0.1.49 真实失败的 FIRST_DIVERGENCE 从“bridge reconnect 后 Observer 无事件”精确到唯一 owner。

## 1. 接管读取

第一步只读：

`spec/平台架构与公共约定/00-公共上下文/README.md`

然后严格按 README 最小顺序读取，并以：

`spec/平台架构与公共约定/00-公共上下文/02-当前接力/CURRENT.md`

作为唯一当前执行真源。

CURRENT.REQUIRED_CONTEXT 指到的历史/Runbook 按需读取，不要重读整个 Real-3 历史。

## 2. 当前冻结事实

```text
J1 = PASS
J2 = PASS
J3 = PASS
J4 = PAUSED_FOR_INTEGRATION_HARDENING
REAL_3 = NOT_PASS

HEAD = 6e9b51a
Extension source fix = 5464f7d
Extension = 0.1.49
Registry exact = PASS
Workspace = 0.1.49
materialized manifest = 0.1.49
Chrome registered SW = 0.1.49
browser-attested verification = 0.1.49 / PAIRING_HEARTBEAT
platform setup = 3/3 PASS
```

固定 Task：`task-a6f859c00b1accd027d53d48`

```text
Task = ACTIVE / v10 / currentNodeId=dev
Dev = IN_PROGRESS / runNo=1 / worker=6a9b4632-ca8c-83e9-a005-2ccfb8c5c8cb
Test = PENDING / runNo=1 / role binding worker=6a9b8ae0-f694-83e8-b4a2-0d20cbc5c04a
```

原 durable wake：

```text
execution:e9b9c020-bfe2-4d85-8a17-e3c4a0b7a2c0
idempotencyKey=task-observer-wake:task-a6f859c00b1accd027d53d48:dev:1:TASK_RESUMED:task-event:10
FAILED / NOT_APPLIED / attemptCount=1
PRECONDITION_FAILED:WAKE_TRIGGER_TYPE_INVALID
```

不得改变其 executionRef/idempotency/fingerprint。

## 3. 0.1.49 最新真实复验

Codex 已经执行过一次且只有一次正式 `platform start`：4 成功 / 19 跳过 / 0 失败。启动后被动等待 20 秒，无人工 recovery。

真实证据：

```text
BRIDGE_MODULE_VERSION=0.1.49
BRIDGE_SESSION_ONLINE=YES
COMMAND_CONSUMER_READY=YES
new bridge listener/hello epoch after start = PROVEN

new execution.listSignals = NONE
new task.projection = NONE
new task.wake = NONE
REDECISION_EVENT = NONE
original Execution unchanged
Task/Dev/Test unchanged
```

因此：

```text
OBSERVER_REARM_REALITY=FAIL
SAME_EXECUTION_REDECISION=FAIL
ROOT_CAUSE=NOT_PROVEN
0.1.50=NOT_ADMITTED
```

## 4. 第一轮只允许做什么

先 read-only 恢复当前 runtime/start-owner 状态；**不要重复 platform start**。

然后把控制链精确到：

```text
production bridge reconnect/hello
→ rearm controller
→ runObserverRecovery
→ observerRecoveryInFlight
→ collaborationCarrier.recoverPending
→ execution.listSignals
```

只区分三个候选：

```text
A. reconnect rearm callback 未调用
B. callback 调用，但被旧 observerRecoveryInFlight pending Promise 吸收
C. recovery 已进入，但 collaborationCarrier.recoverPending/listPending 无界 await 卡住
```

优先使用已有 structured logs、Host request logs、Service Worker 现有 console/state、runtime readback。不要为了方便直接新增日志。

如果已有 evidence 无法区分，明确输出：

`EVIDENCE_GAP=YES`

并设计**最小诊断 seam/instrumentation**，先交用户/总控裁决。缺 evidence 不能直接变成候选 root cause。

## 5. Codex 使用方式

执行类任务优先给 Codex。Codex 是完整开发环境，不要要求它使用 CodeGraph / Repomix / Local Dev MCP。

当且仅当你已经冻结：

```text
CURRENT_ROOT_CAUSE=PROVEN
FIRST_DIVERGENCE=<exact point>
OWNING_CODE_PATH=<exact owner>
ACCEPTANCE=<behavior>
STOP_POINT=<boundary>
```

再给 Codex一份完整提示词，让它一次完成：源码分析 → regression RED → 最小实现 → targeted/full/typecheck/governance → commit → 如获准则单包 release。

在 root cause 未证明前，Codex 只允许做只读结构审计/机械证据收集，不允许 patch。

## 6. Patch Train 止损

最近 50 commits 中 19 个 release 类、17 个 fix，Extension 四天从 0.1.37 连续到 0.1.49。当前已经明确：Real-3 一度被错误地当成 Integration Hardening 环境。

所以：

```text
0.1.49 = CURRENT_RC / REALITY_FAIL
0.1.50 = NOT_ADMITTED
Final Real Gate != Integration Hardening
```

不要再“发现一个 bug → 发一个 patch”。如果需要 0.1.50，必须先完成当前 ownership domain 的相邻 failure matrix，力争只发一个完整 RC。

## 7. 禁止事项

- 不重复 `platform setup/start/update` 作为诊断手段。
- 不 reload Extension / Chrome。
- 不人工 `TASK_OBSERVER_RECOVER`、task.wake、Execution retry。
- 不 task.resume / ACK / reopen。
- 不创建新 Task/Worker/GPT/Execution。
- 不直接写 SQLite、roles、verification、node_modules。
- 不重开 Browser version-attestation、Tunnel、TASK_RESUMED allowlist 等已闭环问题。
- 不 push。

## 8. 最终目标

诊断/Hardening 结束后必须回同一个现场：

```text
same execution:e9... redecision
→ Dev durable file.read
→ Dev complete
→ Test NODE_READY
→ Test durable file.read
→ Test complete
→ Task SUCCEEDED / currentNodeId=null
→ J4 PASS
→ REAL_3 PASS
```

没有第二条验收路径。

第一轮结束只需要向用户汇报：

```text
CURRENT_RUNTIME=
FIRST_DIVERGENCE=
A/B/C=
EVIDENCE=
ROOT_CAUSE_PROVEN=
PATCH_ADMITTED=
CODEX_TASK_IF_ANY=
NEXT_STOP_POINT=
```

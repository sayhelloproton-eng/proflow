---
docId: TASK-DOC-03-05
title: 任务与编排领域｜Task Observer 推进投影与异常诊断边界
docType: cross-domain-flow
authority: normative
lifecycle: active
domain: task-orchestration
boundedContext: task-orchestration
subdomain: null
subdomains:
- task-lifecycle
- node-workflow
provides: []
requires: []
contractRefs:
- PLATFORM-DOC-01-04
---

# 任务与编排领域｜Task Observer 推进投影与异常诊断边界

> Task Observer 的 deterministic decision 与 lost-trigger reconciliation 运行在 backend application；本文冻结 Task Domain 为 Observer/Reconciliation 提供什么正式事实，以及该 application 不得把什么推回 Task。Extension 只提供 Carrier/page reality 与 kick，不承担业务 progression scheduler。

## 1. Task Observer 不是 Task Owner

Task Observer 只做：

```text
READ current owner facts
→ DETECT deterministic next-step condition
→ REQUEST typed carrier/application action
```

它不得直接修改 Task/Node，不得绕过 `startTask/startNode/completeNode/waitNode/reopenNode` 等正式命令。

## 2. Task 应提供的 drive projection

Task Query 至少能够让调用方稳定得到：

```text
taskId / task status / task version
currentNodeId
nodeId / node status / node version / runNo
requiredAgentPackageRef
TaskRoleBinding(agentPackageRef, roleRef, workerRef, conversationLocator)
terminal flag
reopen context（如有）
```

Task 不把 Execution/Collaboration/Carrier 的状态复制进自身 Store；Observer 对这些 Owner 分别读取 public facts。

## 3. 确定性触发

典型条件：

```text
Node READY                      → request WAKE correct Worker
Peer Reply READY                 → request RESUME same Worker
Browser/Carrier durable result   → request RESUME same Worker（仅确实跨 Turn 的内部场景）
Reopen target READY              → request WAKE same Worker/runNo+1
wake/recovery unfinished         → request bounded carrier reconciliation
Task terminal                    → STOP driving
```

Repomix / Local Dev / CodeGraph 的普通 Direct Tool result 在当前 Worker Turn 直接返回，**不是 Observer progression trigger**。具体 Carrier typed command 由 owning internal contract 冻结；Task Domain 不拥有 Browser command vocabulary。

## 4. READY 与 startNode

Task Observer 看到 Node READY 后先恢复/WAKE Worker，不替 Worker 调 `startNode`。Worker 收到 NODE_READY 后，通过正式 Action 调用 `startNode`，Task 才把当前 run 变为 IN_PROGRESS。这样保持：

```text
Observer = detection
Carrier = physical wake
Worker = formal work acceptance
Task = workflow truth
```

## 5. 异步等待不自动变 Task WAITING

以下事实默认保持在原 Owner：

```text
Execution QUEUED/RUNNING/WAITING_APPROVAL
Collaboration PENDING/REPLY_PENDING_DELIVERY
Carrier recovery in progress
```

Task Node 可以继续保持 IN_PROGRESS；结果就绪后由 Observer resume Worker。只有 Worker 明确声明真正 workflow/business blocker 时，才使用 `waitNode` 进入 Task WAITING。

Carrier Attention 的人工 `deny` 不是新的 Task/Node 状态，也不是 business wait command。Browser Carrier 可用 occurrence-scoped continuation denial 抑制当前 tab/Worker 下一次 `BLOCKED → IDLE` 自动 recovery；该记录消费一次即失效，不得影响其他 Worker。`allowOnce` 仍走普通 IDLE recovery。Task Observer 不读取 ChatGPT 按钮、不写该 transient 记录，也不因此修改 Task truth。

Task Observer 的 startup scan、scheduled retry、Task application event 与 durable resume signal 共享同一 Carrier dispatch port；Background 必须在实际 WAKE/RESUME 前执行 active-denial final guard。该 guard 属 Browser Carrier transient control，不进入 Task Observer decision logic 或 Task Store。

## 6. REASON 只作异常诊断旁路

正常 READY/RESULT/REPLY 不调用模型。只有单 Task 出现：

```text
多源事实冲突
UNKNOWN 无法确定 effect/delivery reality
长期 stalled 无单一 blocker
重复 recovery 失败
多个异常需要排序/归因
```

才允许把 bounded sanitized facts 交给 Model REASON。输出仅可包含 finding/probableCause/confidence/recommendedNextObservation/recommendedRecoveryAction/needsHumanAttention；不得直接 complete/reopen/approve/retry uncertain Effect。

## 7. Task 与 System Observer 分流

```text
单 Task / 单 run / 局部异常 → Task Diagnostic Assessment
多 Task / 跨服务 / 趋势性退化 → System Observer
```

Task Domain 不增加 Observer Store、Scheduler、AI Planner 或全局 Event Bus。

## 8. Bounded loop 的可执行语义

Host 每轮从 Task Owner 分页读取有界 nonterminal candidates（初始默认每页 100，非产品不变量）；逐 task 单飞，单次 projection/Owner 调用 bounded timeout，可配置 bounded concurrency（初始默认 4 个 Task 并行，非产品不变量），下一页保留 cursor。完整 sweep 后重置 cursor；周期默认 5s、失败 backoff 上限 30s。一个 stalled Task 不阻塞 cursor 前移或其它 Task。全部 event 丢失仍不断进行完整 sweep；“bounded”同时约束 query、in-flight 和公平性，而不只是 setInterval。

一个 Host workspace lifecycle 只拥有一个 coordinator；从 Extension 移除旧 progression timer，防止双 writer。Task eligibility 每次从 Owner 重读，dispatch 前校验 task/node version、runNo、binding、terminal；排队期间事实变更会废弃旧 decision。Carrier 在实际 effect 前再次通过 Owner public guard 验证当前 generation 与 denial；不能只依赖初次 projection。

WAKE 的内部稳定 dedupe key 使用 taskId/nodeId/runNo/workerRef/trigger/underlying signal ref；不得使用 tick 时间、随机 UUID 或每次 scan 的 taskVersion 生成新 intent。重复 event、catch-up、重启均复用已有 Browser durable Execution 的 effect/reality，UNKNOWN 先观察不重发。单飞仅防并发，不能代替跨轮/重启去重。Task terminal 后不再创建或开始新的 WAKE；terminal 提交前已跨 EFFECT_STARTED 的在途 Browser effect只能按原 durable truth 收敛，不能宣称可撤销已经提交的消息。

诊断先在无 progression lock 下取得 bounded snapshot，再送 Model；慢诊断不能占 per-task single-flight，也不占 deterministic worker pool。结果只记录 assessment，不 dispatch。stop 后 generation 失效，晚到回调不再推进。

分页契约见 `TASK-DOC-02-01`，具体 coordinator 在 platform-host，Task package 只实现 Query/guard。

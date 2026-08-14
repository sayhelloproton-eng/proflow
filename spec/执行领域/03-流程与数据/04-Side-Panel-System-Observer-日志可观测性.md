---
docId: EXECUTION-DOC-03-04
title: 10 · Side Panel、System Observer 与日志可观测性
docType: observability
authority: normative
lifecycle: active
domain: execution
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- PLATFORM-DOC-01-04
- MODEL-DOC-03-08
---

# 10 · Side Panel、System Observer 与日志可观测性

> 2026-08-14 对齐：System Observer 的核心职责是**评估整个 ProFlow 系统**，不是“全局待办处理器”。它是 Extension 中最低优先级的只读/派生评估线，通过跨 Owner 的 bounded data views + 手机 REASON 形成 system assessment；只有评估明确需要动作时才发 typed request/alert/UI request，且永远不拥有业务事实。

---

# 1. Side Panel 的 P0 地位

Side Panel 是本地运行事实与人机交互入口，不是业务真源。至少展示：

```text
Overall system assessment
Task summary / blockers
Worker/Carrier health
Execution in-flight / approval / unknown
Collaboration backlog
Model runtime health
Deployment/service health
System Observer findings/recommendations
```

所有状态必须来自 current Owner facts 或明确标注的 derived assessment；不能把 persisted old READY/ONLINE 当 current reality。

---

# 2. Extension 内两个 Observer 必须分开

## Task Observer

```text
scope = one concrete Task progression
method = deterministic first
question = 这个 Task 是否出现了明确下一步？
```

典型：Node READY、Execution Result READY、Peer Reply READY、Reopen READY。

## System Observer

```text
scope = whole ProFlow
method = bounded snapshots + REASON
question = 整个系统现在整体是否健康？哪里异常/风险/漂移/系统性退化？
```

不得合并成一个 universal scheduler/event bus。

---

# 3. System Observer 的 8 类输入视图

System Observer 不直接把数据库/日志/文档 dump 给模型；每个 Owner 先输出 bounded projection/summary。

## 3.1 Task View

```text
active/terminal tasks
current node/run
stalled duration
last transition
blocked reason
terminal integrity
```

## 3.2 Agent / Worker View

```text
agentPackageRef/packageName
roleRef
workerRef
binding health
conversation locator health
last wake/result
identity mismatch flags
```

## 3.3 Collaboration View

```text
pending/replied/delivery state
pending duration
attempt/recovery summary
source/target worker refs
error summary
```

## 3.4 Execution View

```text
queued/running/waiting approval/unknown/failed
stage/age
result summary
errorCode
recovery count
evidence refs
```

## 3.5 Carrier View

```text
CREATE/RESTORE/WAKE health
physical delivery unknown count
DOM/page failure trend
login/auth anomalies
Vision fallback count
recovery distribution
```

## 3.6 Model View

```text
FAST/REASON/Vision availability
active model/busy
latency/error summary
server_paused/model_busy
recent inference failure trend
```

## 3.7 Deployment / Service View

```text
module READY/DEGRADED/ACTION_REQUIRED
verification freshness
doctor findings
external resource health
service health
```

## 3.8 Log / Artifact / Evidence View

默认只提供：

```text
error aggregation / top error codes
repeated failure trends
test summary
artifact metadata
evidence completeness
recent critical diagnostic excerpts by ref
```

不默认提供全量日志/源码/Task 文档正文/patch 正文。

---

# 4. 三层 System Assessment

## Layer 1｜Deterministic Compact Snapshot

不调用模型。目标：

```text
normalize
remove secrets/full content
dedupe
preserve stable refs/time/status
bound total size
```

## Layer 2｜Concern / Domain Batches

默认可按：

```text
A Task + Worker
B Execution + Approval
C Collaboration + Carrier
D Model + Deployment + Health
```

必要时根据 `maxContextBytes` / 当前真实负载再拆分；批次结构不是业务实体。

每批 REASON 输出至少包含语义：

```text
health
findings
risks
anomalies
hypotheses
unresolved
needsDrilldown
evidenceRefs
confidence
carryForward
```

## Layer 3｜Global Synthesis

输入：

```text
top-level current snapshot
+ batch assessments
+ previous unresolved findings/carry-forward
+ targeted drill-down results
```

目标是形成跨域因果判断，而不是简单拼接分批 summary。

---

# 5. Carry-forward 与“记忆”

System Observer **不依赖 MLXHub/Provider 服务端 Conversation history**。

保存一个 derived Assessment Artifact，例如：

```text
assessmentRef
observedAt
overallHealth
newFindings
persistentFindings
resolvedFindings
risks
hypotheses
evidenceRefs
needsDrilldown
carryForwardSummary
```

下一轮重新读取 Owner current reality，再把仍有价值的 unresolved/carry-forward带入。

Assessment 不是 Business Fact，不允许反向覆盖 Task/Execution/Agent/Deployment truth。

---

# 6. Drill-down

Broad snapshot 发现可疑点后，模型可以请求 targeted data，例如：

```text
specific executionRefs transitions/evidence
specific task history
specific carrier recovery attempts
specific error summaries
specific deployment doctor finding
```

Drill-down 仍通过 Owner Public Query / bounded diagnostic data取得，不读内部 Store绕过 Owner。

---

# 7. System Observer 输出与动作边界

允许输出：

```text
SYSTEM_HEALTH assessment
finding / risk / probable cause
confidence
recommendedAction
needsHumanAttention
needsDrilldown
```

如果明确需要动作，可请求：

```text
SHOW_APPROVAL_DIALOG
RUN_CARRIER_DOCTOR
REQUEST_TARGETED_SCREENSHOT
SURFACE_ALERT
REQUEST_OWNER_REFRESH
```

具体命令以现有 contract 为准。

**不允许直接：**

```text
complete/reopen Task
approve Execution
mark Collaboration delivered
restart everything
rewrite Deployment READY
blind retry UNKNOWN effect
```

---

# 8. 优先级与资源治理

System Observer 永远最低优先级：

```text
user current action
> active Carrier work
> Task Observer
> async result/delivery resume
> System Observer
```

手机 FAST/REASON 是共享受限资源；busy/active business inference 时 System Observer defer/skip cycle。漏一轮没有 correctness 影响，下一轮重新读取 reality。

---

# 9. Task-level Diagnostic 与 System Observer 分流

```text
one Task/run/local ambiguity
→ Task Diagnostic REASON

multi-task/cross-service/system trend
→ System Observer REASON
```

Task Diagnostic 与 System Assessment 都只能给 finding/recommendation，不获得 workflow/effect authority。

---

# 10. Side Panel Human / Alert UI

Side Panel/Extension 可承载 v1：

```text
Task start confirmation
Execution Approval presentation
System alert/findings
Deployment ACTION_REQUIRED guidance
```

但 UI channel ≠ Owner。未来 Feishu 只替换 interaction channel。

---

# 11. Structured Logging

日志是 Task Journey 技术影子，不是 Business Fact/Evidence。

最小关联轴：

```text
timestamp / level
component / capability / operation / status / errorCode
correlationId
taskId / nodeId / runNo
agentPackageRef / roleRef / workerRef
executionRef / messageRef / artifactRef / evidenceRef
operationRef / attemptNo / tabId（技术诊断）
```

Browser Extension 通过本地 runtime 接口提交结构化日志；日志落 `.proflow/logs/**` 或当前正式日志路径。

---

# 12. Redaction

绝不记录：

```text
raw Role credential / Authorization
provider secret/cookie/password/private key
full prompt/reply
full file/context pack/patch
screenshot binary
```

允许记录 ref/hash/MIME/size、bounded error summary、screenshotRef。

---

# 13. 不建设独立 Observability / System-Assessment Domain

System Observer 是 Extension application component；Assessment 可作为 derived diagnostic artifact 保存，但不建立第二套业务 Store/State Machine/Scheduler。

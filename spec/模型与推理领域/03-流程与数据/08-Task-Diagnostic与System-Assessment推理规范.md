---
docId: MODEL-DOC-03-08
title: 模型与推理领域｜Task Diagnostic 与 System Assessment 推理规范
docType: reasoning-spec
authority: normative
lifecycle: active
domain: model-reasoning
boundedContext: model-reasoning
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- PLATFORM-DOC-01-04
---

# 模型与推理领域｜Task Diagnostic 与 System Assessment 推理规范

> 本文定义 Observer 调用 Model Runtime 时的认知边界。Model 只提供结构化 judgment；Task/System Observer 仍是调用方，任何 Owner business fact / Effect / Approval 均不转移给 Model。

## 1. 两类推理用途

### Task Diagnostic

单 Task 异常归因，仅在 deterministic rules 无法安全解释时使用 REASON。

### System Assessment

跨 Task/Execution/Carrier/Model/Deployment/日志趋势的系统级评估，REASON 是主要认知层，但输出仍是 derived assessment。

二者都不是新的 Agent/Worker。

## 2. Task Diagnostic 输入/输出

输入必须 bounded、sanitized，并显式携带 refs/current facts：

```text
task/node/run
worker binding summary
last wake/delivery summary
relevant execution summary
relevant collaboration summary
recovery attempts/error codes
evidence refs
```

输出语义：

```text
finding
probableCause
confidence
recommendedNextObservation
recommendedRecoveryAction
needsHumanAttention
```

禁止 decision vocabulary 直接等价于 `completeNode/reopenNode/approve/retryEffect`。

## 3. System Assessment bounded views

调用方先构造以下只读投影；Model Runtime 不反向查领域 DB：

1. Task View：active tasks/current node/run/stalled duration/recent transitions/terminal integrity。
2. Agent/Worker View：package/role/worker binding、conversation locator health、last wake/identity anomaly。
3. Collaboration View：pending/replied/delivery backlog/wait duration/error summary。
4. Execution View：queued/running/waiting approval/unknown/failed、result/evidence summary、recovery count。
5. Carrier View：restore/wake/delivery、DOM drift、Vision fallback、retry/failure trends。
6. Model View：FAST/REASON/runtime health、active role、busy/latency/error trend。
7. Deployment/Service View：READY/DEGRADED/ACTION_REQUIRED、verify freshness、external resource health。
8. Log/Artifact/Evidence View：error aggregation、test summary、artifact metadata、evidence completeness、critical anomaly summaries。

默认不传全部 Requirement、源码、日志全文、patch 全文、screenshot base64、credential。

## 4. Context budget 与分层评估

`ReasoningSpec.maxContextBytes` 是硬 gate。Runtime 不偷偷截断；超限返回 `CONTEXT_TOO_LARGE`。调用方必须分批/压缩。

推荐三层：

```text
Layer 1 deterministic compact snapshot
Layer 2 concern/domain assessments
Layer 3 global synthesis
```

默认 concern batches：

```text
A Task + Worker
B Execution + Approval
C Collaboration + Carrier
D Model + Deployment + Health
```

可以按实际 token/byte budget 自适应拆分，但不得简单删除高风险 finding/evidence refs。

## 5. 每批 assessment contract

语义至少包含：

```text
scope
observedAt
health
findings[]
risks[]
anomalies[]
hypotheses[]
unresolved[]
needsDrilldown[]
evidenceRefs[]
confidence
carryForward[]
```

不要求本阶段立即冻结最终字段名；Batch4 实现前必须落为 versioned ReasoningSpec + runtime schema。

## 6. 显式 carry-forward

不依赖 provider/MLXHub server-side conversation memory。下一轮输入：

```text
current snapshot
+ previous unresolved findings
+ previous carryForward
+ changed/resolved facts
```

carry-forward 只保留仍需追踪的 hypothesis/risk/ref/confidence/drill-down，不把旧原始输入全文重复塞回。

## 7. Drill-down

Broad assessment 发现异常后，可请求 targeted data。例如 UNKNOWN 增长时，只取相关 executionRefs、recent transitions、error summaries、evidence metadata、carrier/network correlations，再做 refined assessment。

`needsDrilldown` 是建议，不允许 Model 自己读取外部资源。

## 8. Global synthesis

最终 synthesis 输入由 top-level current snapshot + concern assessments + previous unresolved + drill-down results 组成。目标是发现跨域因果，不是拼接 summary。

输出至少语义包含：

```text
overallHealth
criticalFindings
majorRisks
systemicAnomalies
crossDomainHypotheses
resolved/persistent/new findings
recommendedActions
needsHumanAttention
needsDrilldown
confidence
```

## 9. FAST / REASON / Human

正常 Observer deterministic condition 不调用模型。普通结构化摘要可 FAST；Task complex diagnosis / System assessment global synthesis 用 REASON。REASON 不可用时 assessment defer，不得阻塞 Task 主链。

```text
Hard Rule / Owner Fact
→ Deterministic
→ FAST when sufficient
→ REASON for real ambiguity/causal synthesis
→ Human only for authorization/high risk/still unresolved
```

## 10. Assessment persistence

System assessment 可以持久化为 bounded diagnostic artifact（例如 assessmentRef + observedAt + findings/refs/carryForward），但它不是 Model business DB、不是 System Observer truth store，也不能反向覆盖 Owner state。持久化必须沿既有平台 local artifact/log mechanics，不新增 Assessment Service/Domain。

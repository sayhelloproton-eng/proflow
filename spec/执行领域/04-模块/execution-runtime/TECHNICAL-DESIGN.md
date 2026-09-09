---
docId: EXECUTION-EXECUTION-RUNTIME-TECH-DESIGN
title: 03 · execution-runtime 详细技术方案
docType: module-design
authority: normative
lifecycle: active
domain: execution
moduleRef: execution-runtime
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- EXECUTION-DOC-02-01
- EXECUTION-DOC-02-02
- EXECUTION-DOC-03-01
- EXECUTION-DOC-03-03
---

# 03 · execution-runtime 详细技术方案

## 1. 角色

`execution-runtime` 是**内部 durable Execution** 的控制真源，不再是 GPT 本地工程 Tool 的统一路由器。

继续负责：Browser/Carrier durable effect、physical delivery、Effect Approval、UNKNOWN/recovery，以及仍有真实内部 caller 的 durable materialization/Artifact 生命周期。

不负责：Repomix / Local Dev / CodeGraph GPT Tool Action。

## 2. Internal lifecycle

仍进入 Execution 的 effect 使用：

```text
validate identity/scope
→ durable intent/idempotency
→ Policy
→ FAST/REASON only when needed
→ Approval when required
→ EFFECT_STARTED
→ Browser/other internal executor
→ Result/Evidence
→ APPLIED / NOT_APPLIED / UNKNOWN
```

persist-before-effect、stale Approval revalidation、UNKNOWN no-blind-replay 不因 Tool 重构而削弱。

## 3. Local Tool exclusion

以下路径禁止：

```text
repomix/localDev/codeGraph
→ executeCapability
→ Execution Record
→ executionRef
→ getExecution/readExecutionOutput
```

Local Tools 的真实链见 `AGENT-DOC-02-05`。Execution Runtime unavailable 不能成为 Local Tool 的硬依赖。

## 4. Executor migration

历史 `local-adapter` / local capability wrapper 只在仍有内部 durable caller 时保留。实现阶段先用 CodeGraph/caller 证据区分：

- Browser/Carrier/materialization 等仍需 durable semantics → 保留/收窄；
- 仅为旧 GPT file/git/shell capability 服务 → caller 归零后删除；
- 可复用底层 primitive → 下沉 `execution-local` 内部实现，不恢复 GPT Execution lifecycle。

## 5. Browser dependency

Browser durable effect 继续通过 Browser Extension Browser lane `/v1/commands/*` 执行，但 `execution-runtime` **不再创建或关闭 Browser Reality Bridge**。Bridge runtime 生命周期归 `execution-browser-extension` 模块；Execution Runtime 只持有 Browser lane client/port，并消费该模块发布的 endpoint/credential/readiness。

因此停止/重启 `execution-runtime` 不得销毁 Extension bridge session，也不得影响 Local Tool lane `/v1/local-tools/commands/*`。Local Tool lane 与该 Runtime 生命周期无关，两条 Extension lane 不共享 queue/timeout/backoff/state。

## 6. Approval / recovery

Approval 仍绑定 execution/caller/target/fingerprint/precondition/scope/expiry，并在 effect boundary revalidate。EFFECT_STARTED 后失联先 reality reconciliation；无法确认即 UNKNOWN。

## 7. Signals / Task progression

Execution 可以发布 durable recovery/result facts，但**不调度 Task**。backend Task Observer/Reconciliation 消费 current facts并决定是否请求 Carrier WAKE；Extension background 不再拥有 Task progression scheduler。

## 8. Failure isolation

- Model diagnostic unavailable：不阻塞无需模型的 deterministic path；
- Local Tool unavailable：不改变 Execution durable truth；
- Execution Runtime unavailable：不阻塞 Task/Peer/Local Tools，只让真正需要内部 durable Execution 的 operation unavailable。

## 9. Non-responsibilities

不实现 Task scheduler、Agent collaboration state machine、Browser DOM rules、GPT Tool router、MCP runtime、Local Dev/Repomix/CodeGraph public route、Deployment lifecycle。

---
docId: EXECUTION-CHARTER
title: 执行领域｜领域宪章与 Bounded Context Map
docType: domain-charter
authority: normative
lifecycle: active
domain: execution
boundedContext: execution
canonicalFor:
- execution.boundary
- execution.bounded-context-map
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- AGENT-DOC-02-05
---

# 执行领域｜领域宪章与 Bounded Context Map

## 1. Purpose

Execution 只负责**确实需要 durable effect semantics 的内部执行**：在真实 Browser/Carrier、副作用审批、UNKNOWN/recovery、physical delivery 与仍有内部 caller 的 materialization 场景中，把已获准的 intent 转换为可恢复 Effect，并形成 Result / Artifact / Evidence。

GPT-facing 本地工程工具不再属于 Execution Capability 主链。Repomix / Local Dev / CodeGraph 通过 `Action → Gateway → ProFlow API → Browser Extension → 独立 Local Tool lane → execution-local → macOS` 执行。

## 2. Owns

- durable Execution Record / status / sideEffectState（仅内部 durable effect 场景）
- Effect policy / Approval / precondition / UNKNOWN recovery
- Browser/Carrier real effect 与 physical collaboration delivery 的 Result / Evidence
- 仍有内部 caller 的 external-file/materialization Artifact truth
- Browser Effect reconciliation / no-blind-replay

`execution-local` 属于 Execution 领域的本机实现扩展包，但其中 `local-dev / repomix / codegraph` 的 GPT-facing Tool 调用**不经过 execution-runtime lifecycle**。

## 3. Does Not Own

- Task workflow / Task progression truth
- Role/Worker ownership
- Model business judgment ownership
- Deployment lifecycle
- GPT-facing Tool product model、Role×Tool×Operation authorization
- Local Tool command queue/readiness/audit 的第二业务真源

## 4. 主 Bounded Context

```text
execution
```

当前不因 package/service/folder 自动增加 Bounded Context。Browser durable execution 与 Local Tool implementation 可以同属本领域工程包，但调用语义不同：前者可进入 Execution durable lifecycle，后者按 Tool contract 直接返回结果。

## 5. Module map

| Module | Package | Runtime | 当前职责 |
|---|---|---|---|
| execution-contracts | `@tomflow/proflow-execution-contracts` | library | 内部 durable Execution / Browser contract、Result/Evidence/Approval/UNKNOWN 类型 |
| execution-runtime | `@tomflow/proflow-execution-runtime` | backend service | durable Browser/Carrier/Approval/UNKNOWN/materialization control plane |
| execution-local | `@tomflow/proflow-execution-local` | local library/runtime implementation | `local-dev / repomix / codegraph` 本机实现；必要内部 primitive 可被 Execution 复用 |
| execution-browser-extension | `@tomflow/proflow-execution-browser-extension` | Chrome Extension | Browser Carrier + Deployment line + 独立 Local Tool Effect Gate/lane |

## 6. Public / Internal Boundary

`executeCapability/getExecution/readExecutionOutput/cancelExecution` 若仍由实现保留，只是**平台内部 Execution service contract**，不再是 Custom GPT Actions，也不进入五概念模型心智。

Custom GPT 的本地工程工具固定为：

```text
Repomix   → pack / grep / read
Local Dev → read / list / search / mutate / run / process
CodeGraph → explore
```

正式 Tool contract 见 `AGENT-DOC-02-05`。

## 7. Cross-domain requirements

Execution 只通过 Public Contract 获取必要事实：Task/Worker scope、Agent delivery target、Model bounded diagnostic（确有需要时）、Deployment config。Local Tool 请求本身 Task-agnostic，不要求 Task/Node/Worker/Execution identity。

## 8. Hard invariants

- Host/API 不得绕过 Browser Extension 直连本机 Tool。
- Local Tool 不得重新包装为 `executeCapability → executionRef → polling/readOutput`。
- Browser `/v1/commands/*` 与 Local Tool `/v1/local-tools/commands/*` 使用独立 lane；Local Tool 慢/挂不得阻塞 WAKE/submit/heartbeat。
- Task Observer deterministic progression / lost-trigger reconciliation 位于 backend application；Extension 不承担业务 progression scheduler。
- Browser/Approval/UNKNOWN 等 durable internal Effect 继续保留 persist-before-effect 与 reality-first recovery。

---
docId: TP-PLATFORM-01
title: 跨领域 Contract 与 Integration 测试计划
docType: test-plan
authority: normative
lifecycle: active
domain: platform
subdomain: null
subdomains: []
boundedContext: null
moduleRef: null
provides: []
requires: []
contractRefs: []
testPlanPhase: PRE_IMPLEMENTATION
testPlanStatus: FINAL_FROZEN
sourceBaseline: proflow-source-da55f875-20260816-085708.zip
sourceBaselineSha256: d44aee2e4b5e31647de5fcdc2adea7ca39c90bd1734b854198524f1ac239a09e
sourceReconciledThrough: PHASE3_BATCH6_NON_E2E_CLOSURE_20260816
sourceRefs:
- PLATFORM-DOC-03-02
- PLATFORM-DOC-01-01
- PLATFORM-DOC-02-01
---

# 跨领域 Contract 与 Integration 测试计划

## 1. 目标

证明五领域只通过 Public Contract协作，Owner truth不漂移；Extension/Gateway/platform-host/Observers 作为 Application/Adapter 不成为第二业务 Owner。

## 2. 强制 Contract Pairs

| Pair | Provider 证明 | Consumer 证明 | Integration 证明 |
|---|---|---|---|
| Task ↔ Agent | Task/Node/TaskRoleBinding/TaskDocument/version | Agent opaque identity 使用 | Extension New Task 三 Worker binding；same Worker reopen |
| Task ↔ Carrier | Task drive projection / stable binding | Task Observer只读，Carrier只物理 wake | READY→RESTORE/WAKE→Worker startNode；terminal stop-driving |
| Task ↔ Execution | Task progress facts | Execution只拥有 real Effect/Result/Evidence/Approval | async result ready 后 wake，不自动 Task WAIT |
| Task ↔ Collaboration | Task只保存 correlation refs | Message Center owning ask/reply/delivery | reply ready→wake source；无自动 Task transition |
| Agent ↔ Execution | Agent表达 intent/delivery need | Execution拥有 physical Browser/local effect | file materialization、peer delivery、UNKNOWN reconciliation |
| Agent Gateway ↔ Owners | typed external DTO/auth | Task/Agent/Execution做业务 validation | no custom headers；45s/100k/File Bridge budget；idempotency |
| Execution ↔ Model | Model structured cognition | Execution重做 Policy/effect legality | Hard Rule > FAST/REASON；model confidence不越权 |
| Extension System Observer ↔ Model | bounded snapshots由各 Owner提供 | Model只算 assessment | batching/carry-forward/drill-down/global synthesis；无写权 |
| Deployment ↔ Modules | Module真实 lifecycle/requirements | CLI/adapter按 public primitive工作 | capability/readiness/ACTION_REQUIRED/current reality |
| platform-host ↔ Domains | Owner contracts稳定 | host只composition/transport | no state mirror/scheduler；restart re-read owner facts |

## 3. Identity Contract

必须证明：

```text
agentPackageRef/packageName = logical role
roleRef = deployed GPT
credential = GPT→Gateway secret
workerRef = Task-scoped Conversation identity
conversationLocator = Carrier restore locator
tabId = transient only
```

Browser不验证 credential；Task不保存 frame/tab business identity；credential不等于packageName。

## 4. Worker Turn / Native Capability Contract

同一 Worker Turn可连续 `0..N` Actions。Contract tests必须拒绝以 Action completion event 驱动 Browser “continue”的隐式协议。

File Bridge transport不拥有 TaskDocument/Artifact/Evidence；Context Pack/Patch是Execution Artifact subtype。

## 5. Observer Contract

Task Observer：只读 current facts、deterministic next-step；异常 REASON只诊断。

System Observer：只读 bounded views，输出 derived assessment；任何 recommendation在执行前仍需Owner/Controller validation。

## 6. Required Failure Families

- provider/consumer schema/version不兼容；
- consumer deep-import/provider DB读取；
- duplicate fact ownership；
- transport failure被误写成business success；
- Conversation memory/DOM/log替代fresh owner state；
- model assessment覆盖Owner fact/Policy；
- pending Execution/Peer被错误映射为Task WAIT；
- Reopen创建新Worker；
- Browser UNKNOWN盲重放；
- System Observer不可用阻断Task主链。

## 7. STOP

任何接线需要 shared DB、复制状态机、persistent tab/frame identity、Gateway/host business persistence、Observer direct mutation、模型绕过Policy，立即 STOP。

## 8. Evidence

Provider/Consumer schema result、integration trace、owner state refs、Task drive projection、Carrier delivery result、Execution Evidence、Collaboration receipt、Model assessment artifact、必要真实Browser/Custom GPT observation。

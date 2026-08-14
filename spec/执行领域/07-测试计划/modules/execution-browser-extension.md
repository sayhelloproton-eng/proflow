---
docId: TP-MODULE-EXECUTION-BROWSER-EXTENSION
title: execution-browser-extension｜开发前 Module Test Plan
docType: test-plan
authority: normative
lifecycle: active
domain: execution
subdomain: null
subdomains: []
boundedContext: execution
moduleRef: execution-browser-extension
provides: []
requires: []
contractRefs: []
testPlanPhase: PRE_IMPLEMENTATION
testPlanStatus: FINAL_FROZEN
sourceBaseline: ProFlow-ProFlow-DDD规范化技术文档-最终冻结基线-20260812.zip
sourceBaselineSha256: 69fdfbac8a5ee36b700bcb10c0b8a9a61f0a5aa3367386cb5bc7e98118a4a875
sourceRefs:
- EXECUTION-EXECUTION-BROWSER-EXTENSION-TECH-DESIGN
- EXECUTION-DOC-05-02
- AGENT-CROSS-DOMAIN-INTEGRATION-CHECKLIST
implementationWave: Wave 5
---

# `execution-browser-extension`｜开发前 Module Test Plan

## 1. Risk

该Module同时承载真实ChatGPT页面Effect与Extension application逻辑，最大风险是把transient browser reality升级为业务truth、重复submit，或把Task/System Observer做成新Scheduler/Owner。

## 2. Required Layers

- Unit / typed operation helpers
- Module Integration
- Cross-domain Integration
- Real Chrome + ChatGPT E2E
- Failure / Recovery
- Security / Boundary
- Concurrency / Idempotency

## 3. Critical Proofs

- [ ] **CP-EXE-BR-01** — `agentPackageRef/roleRef/workerRef/conversationLocator`稳定；tab/content transient；无frame/persistent-tab business identity。
- [ ] **CP-EXE-BR-02** — Extension New Task：Task(PENDING)后CREATE/observe/bind三Worker，Product可先工作，partial failure只补missing Worker。
- [ ] **CP-EXE-BR-03** — RESTORE/WAKE正确Conversation；minimal wake；WAKE success仅physical delivery。
- [ ] **CP-EXE-BR-04** — Node READY→Task Observer wake→Worker formal `startNode`；Observer不写Task。
- [ ] **CP-EXE-BR-05** — one Worker Turn支持0..N Actions；Browser无per-action “continue”或natural-language business parsing。
- [ ] **CP-EXE-BR-06** — routine Action Always Allow主链；unexpected permission prompt可恢复；Execution Approval独立。
- [ ] **CP-EXE-BR-07** — DOM-first page operation，异常结构才screenshot→Vision；Vision不直接成为Task/Execution success。
- [ ] **CP-EXE-BR-08** — Collaboration physical delivery durable/idempotent；message/reply owner仍Agent。
- [ ] **CP-EXE-BR-09** — submit/WAKE effect uncertainty按DELIVERED/ABSENT/UNKNOWN reality reconciliation，无blind replay。
- [ ] **CP-EXE-BR-10** — Task Observer deterministic；异常REASON only diagnostic/no authority；terminal stop-driving。
- [ ] **CP-EXE-BR-11** — System Observer 8 bounded views + batching/carry-forward/drill-down/global synthesis，lowest priority/no owner mutation。
- [ ] **CP-EXE-BR-12** — ordinary file transport不经Browser DOM；File Bridge/Execution materialization主链可用，image→Vision fallback保留。

## 4. Failure Families

```text
duplicate CREATE
stale tab/content
wrong c-id / role mismatch
submit-after-disconnect unknown
Chrome restart locator restore
DOM drift
unexpected permission prompt
peer delivery lost
Task terminal ghost wake
Task Observer model used on normal READY
System Observer blocks business lane
System assessment attempts direct mutation
Browser file manager/frame registry reintroduced
```

## 5. Real / Fake Boundary

协议helper可fake Chrome API；以下必须真实Chrome+ChatGPT：c-id observation、Conversation CREATE/RESTORE/WAKE、DOM submit、Always Allow/permission behavior、multi-action Turn、reload/restart recovery。System Observer REASON需要真实手机模型负载验证；可用fixed snapshots做contract/unit测试但不能宣称real-load PASS。

## 6. Evidence

```text
Task owner snapshot before/after binding
workerRef/conversationLocator observation
Carrier typed operation result
wake intent / delivery evidence
same Conversation recovery trace
multi-action no-extra-wake trace
Collaboration delivery receipt
Vision fallback ref
Task Observer request trace
System assessment/batch/carry-forward/drill-down refs
UNKNOWN reconciliation record
```

## 7. GO / STOP

GO：上述Proof都能在Owner boundary下实现。  
STOP：必须靠frame/persistent tab/business store/Browser natural-language Task inference/Observer direct write才能通过。

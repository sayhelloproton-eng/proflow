---
docId: TP-MODULE-MODULE-CONTRACT
title: module-contract｜开发前 Module Test Plan
docType: test-plan
authority: normative
lifecycle: active
domain: deployment-governance
subdomain: null
subdomains: []
boundedContext: deployment-governance
moduleRef: module-contract
provides: []
requires: []
contractRefs: []
testPlanPhase: PRE_IMPLEMENTATION
testPlanStatus: FINAL_FROZEN
sourceRefs:
- DEPLOYMENT-MODULE-CONTRACT-TECH-DESIGN
- DEPLOYMENT-DOC-05-02
- DEPLOYMENT-DOC-05-03
implementationWave: Wave 0
---

# module-contract 测试计划

## R2 contract targets

- 七标准能力 schema/adapter contract 可验证。
- `ModuleStatusObservation` 只接受 `setupStatus=READY|ACTION_REQUIRED|FAILED` 与 `runtimeStatus=RUNNING|STOPPED|FAILED|NOT_APPLICABLE`。
- `configStatus/missingConfig` active schema/export/caller = 0。
- public config schema 不接受 deterministic/private/shared-fact 冒充用户配置。
- `provides/requires` runtime topology semantics 保持。
- `DOCS.md/SETUP.md` 标准知识合同可验证。
- static/runtime descriptor identity/version 一致。

旧 Core/install closure/preflight/mandatory verification assertions 必须删除，不得倒逼恢复产品字段。

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

- `installClass/installRequires` active schema/export/caller = 0。
- `ModuleStatusObservation` 接受 `READY|INCOMPLETE|INVALID` + `RUNNING|STOPPED|FAILED|UNKNOWN`。
- `missingConfig` 只允许 `INCOMPLETE`。
- `provides/requires/configSlots/documentation` 保持兼容。
- static/runtime descriptor identity/version 一致。

旧 Core/install closure assertions 必须删除，不得倒逼恢复产品字段。

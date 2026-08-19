---
docId: TP-MODULE-DEPLOYMENT-CONFORMANCE
title: deployment-conformance｜开发前 Module Test Plan
docType: test-plan
authority: normative
lifecycle: active
domain: deployment-governance
subdomain: null
subdomains: []
boundedContext: deployment-governance
moduleRef: deployment-conformance
provides: []
requires: []
contractRefs: []
testPlanPhase: PRE_IMPLEMENTATION
testPlanStatus: FINAL_FROZEN
sourceRefs:
- DEPLOYMENT-DEPLOYMENT-CONFORMANCE-TECH-DESIGN
- DEPLOYMENT-DOC-05-02
- DEPLOYMENT-DOC-05-03
implementationWave: Wave 0
---

# deployment-conformance 测试计划

## R2 conformance targets

- governed package identity/discovery metadata 正确。
- static/runtime descriptor 一致。
- active installClass/installRequires/Core closure checks = 0。
- ModuleStatusObservation shape mismatch = 0。
- config-bearing Module documentation gap = 0。
- Runtime provides/requires unresolved/incompatible/cycle 仍被 architecture/conformance gate 捕获。
- business external-resource availability 不进入本 gate。

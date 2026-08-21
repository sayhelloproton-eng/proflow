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
- Module operation result 只接受 `SUCCEEDED/ACTION_REQUIRED/FAILED`；`BLOCKED` 仅属于 Platform orchestration/aggregation outcome。
- `configStatus/missingConfig` active schema/export/caller = 0。
- public config schema 不接受 deterministic/private/shared-fact 冒充用户配置。
- `provides/requires` runtime topology semantics 保持。
- `DOCS.md/SETUP.md` 标准知识合同可验证。
- static/runtime descriptor identity/version 一致。

旧 Core/install closure/preflight/mandatory verification assertions 必须删除，不得倒逼恢复产品字段。

## Setup Contract 新增证明

- `ACTION_REQUIRED` 只表达真正人工/外部动作。
- setup result 能让 AI 得到最小人工输入与 package-owned executable/verify。
- Contract 不要求 Platform 保存 step state 或理解 Module 私有配置。
- Contract 支持 `platform setup` 对全部非 READY Module 一次遍历并一次性聚合。

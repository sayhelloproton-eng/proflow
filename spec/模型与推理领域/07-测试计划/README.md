---
docId: TP-MODEL-REASONING-README
title: Model & Reasoning｜测试计划导航
docType: test-plan
authority: normative
lifecycle: active
domain: model-reasoning
subdomain: null
subdomains: []
boundedContext: model-reasoning
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
- MODEL-DOC-05-02
- MODEL-DOC-05-03
testPlanAuthoringOrder: 3
---

# Model & Reasoning｜开发前测试计划

> Test Plan Authoring Order：**3**  
> 本目录新增于 FINAL FROZEN DDD/SDD 之后；不修改领域文档，只把已有规范转成开发前验证合同。

## 阅读顺序

1. [00-领域测试总计划](00-领域测试总计划.md)
2. Module Plans：
- [model-contracts](modules/model-contracts.md) — Wave 2
- [model-runtime](modules/model-runtime.md) — Wave 2

## Frozen Quality Sources

- [`MODEL-DOC-05-02`](../05-质量与部署/02-测试验收-M1到M4.md)
- [`MODEL-DOC-05-03`](../05-质量与部署/03-新仓库实现顺序与停止门.md)

## 原则

Domain Test Plan 不重新定义状态/API/DDL/Package；Module Test Plan 也不把 TODO 的 `PENDING_DECISION / NOT_FROZEN / PLANNED` 自动改成实施依赖。测试计划只冻结可从现有规范证明的 Test Objective 与 Gate。

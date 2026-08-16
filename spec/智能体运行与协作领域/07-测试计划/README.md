---
docId: TP-AGENT-RUNTIME-COLLABORATION-README
title: Agent Runtime & Collaboration｜测试计划导航
docType: test-plan
authority: normative
lifecycle: active
domain: agent-runtime-collaboration
subdomain: null
subdomains: []
boundedContext: agent-runtime-collaboration
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
- AGENT-DOC-05-01
- AGENT-CROSS-DOMAIN-INTEGRATION-CHECKLIST
- AGENT-DOC-05-03
testPlanAuthoringOrder: 5
---

# Agent Runtime & Collaboration｜开发前测试计划

> Test Plan Authoring Order：**5**  
> 本目录新增于 FINAL FROZEN DDD/SDD 之后；不修改领域文档，只把已有规范转成开发前验证合同。

## 阅读顺序

1. [00-领域测试总计划](00-领域测试总计划.md)
2. Module Plans：
- [agent-runtime](modules/agent-runtime.md) — Wave 4
- [agent-gateway](modules/agent-gateway.md) — Wave 4
- [agent-product](modules/agent-product.md) — Wave 4
- [agent-controller-dev](modules/agent-controller-dev.md) — Wave 4
- [agent-test-ops](modules/agent-test-ops.md) — Wave 4

## Frozen Quality Sources

- [`AGENT-DOC-05-01`](../05-质量与部署/01-失败恢复版本安全与验收.md)
- [`AGENT-CROSS-DOMAIN-INTEGRATION-CHECKLIST`](../05-质量与部署/02-跨领域一致性验收清单.md)
- [`AGENT-DOC-05-03`](../05-质量与部署/03-实施顺序与落库门禁.md)

## 原则

Domain Test Plan 不重新定义状态/API/DDL/Package；Module Test Plan 也不把 TODO 的 `PENDING_DECISION / NOT_FROZEN / PLANNED` 自动改成实施依赖。测试计划只冻结可从现有规范证明的 Test Objective 与 Gate。

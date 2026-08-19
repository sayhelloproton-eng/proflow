---
docId: TP-MODULE-MODULE-SKILL
title: module-skill｜开发前 Module Test Plan
docType: test-plan
authority: normative
lifecycle: active
domain: deployment-governance
subdomain: null
subdomains: []
boundedContext: deployment-governance
moduleRef: module-skill
provides: []
requires: []
contractRefs: []
testPlanPhase: PRE_IMPLEMENTATION
testPlanStatus: FINAL_FROZEN
sourceRefs:
- DEPLOYMENT-GOVERNANCE-TECH-MODULE-SKILL
- DEPLOYMENT-DOC-05-03
implementationWave: Wave 6
---

# module-skill 测试计划

## R2 skill targets

- Skill 明确 Module owns config/status/validate/lifecycle truth。
- Platform 只 discovery/aggregation/dispatch/ordering。
- Package manager owns npm dependency mutation。
- 不出现 `installClass/installRequires` 创建指导。
- 不推荐 removed Platform commands 或 package-local single install。
- config-bearing Module guidance 包含来源/格式/敏感性/materialization/完成判定。

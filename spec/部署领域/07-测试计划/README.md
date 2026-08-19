---
docId: TP-DEPLOYMENT-GOVERNANCE-README
title: Deployment｜测试计划导航
docType: test-plan
authority: normative
lifecycle: active
domain: deployment-governance
subdomain: null
subdomains: []
boundedContext: deployment-governance
moduleRef: null
provides: []
requires: []
contractRefs: []
testPlanPhase: PRE_IMPLEMENTATION
testPlanStatus: FINAL_FROZEN
sourceRefs:
- DEPLOYMENT-DOC-05-02
- DEPLOYMENT-DOC-05-03
testPlanAuthoringOrder: 1
---

# 部署领域｜测试计划

当前测试计划只围绕两层正式事实：

```text
Module Governance
+ six-command Platform CLI
```

## Module governance plans

- [module-contract](modules/module-contract.md)
- [module-template](modules/module-template.md)
- [module-skill](modules/module-skill.md)
- [deployment-conformance](modules/deployment-conformance.md)

## Platform CLI plan

- [platform-cli](modules/platform-cli.md)

旧 command/engine 测试只能作为历史参考，不能作为当前产品 acceptance truth。

最终验证路径固定为：`install → modules → docs → configure via Module docs → start → modules → stop → uninstall`。

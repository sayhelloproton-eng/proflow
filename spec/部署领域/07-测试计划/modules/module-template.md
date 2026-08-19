---
docId: TP-MODULE-MODULE-TEMPLATE
title: module-template｜开发前 Module Test Plan
docType: test-plan
authority: normative
lifecycle: active
domain: deployment-governance
subdomain: null
subdomains: []
boundedContext: deployment-governance
moduleRef: module-template
provides: []
requires: []
contractRefs: []
testPlanPhase: PRE_IMPLEMENTATION
testPlanStatus: FINAL_FROZEN
sourceRefs:
- DEPLOYMENT-MODULE-TEMPLATE-TECH-DESIGN
- DEPLOYMENT-DOC-05-02
- DEPLOYMENT-DOC-05-03
implementationWave: Wave 0
---

# module-template 测试计划

## R2 template targets

- CLI 不再要求 `--install-class`。
- generated package metadata/descriptor 不含 `installClass/installRequires`。
- generated status seam 符合 ModuleStatusObservation。
- config-bearing profile 生成足够配置指导。
- service/browser/external profile 只生成真实适用的 lifecycle seam。
- 不生成 package-local `platform install <self>` wrapper。

测试只验证治理形式，不验证领域业务实现。

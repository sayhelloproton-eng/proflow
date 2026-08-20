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

- generated package metadata/descriptor 不含旧 install classification。
- 所有六种 profile 都生成七标准 adapter commands。
- generated status seam 符合 `setupStatus/runtimeStatus`。
- 所有 profile 生成 `DOCS.md` 与 `SETUP.md`，不生成标准 `CONFIGURATION.md`。
- deterministic config materialization 进入 install；真实人工/外部步骤进入 setup。
- service/browser/external/library profile 不因 kind 缺失标准能力；无独立 runtime 用 no-op + `NOT_APPLICABLE`。
- Template create CLI 作为 legitimate extra capability 保留。
- 不生成 Platform config bus、production binding middleman 或 package-local Platform wrapper。

测试只验证治理形式，不验证领域业务实现。

## Setup Template 新增证明

- 生成的 `SETUP.md` 必须是最短 Step 闭环。
- 每个状态推进 Step 必须声明 package-owned executable/verify 与 Success Condition。
- 能自动化的步骤不得生成 Human Action；只有真实外部/用户动作才可要求人工。
- 生成结构必须允许 Platform 全量聚合而无需 module-specific 解释。

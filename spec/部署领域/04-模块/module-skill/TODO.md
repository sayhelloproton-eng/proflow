---
docId: DEPLOYMENT-GOVERNANCE-TODO-MODULE-SKILL
title: '`module-skill` TODO'
docType: todo
authority: operational
lifecycle: active
domain: deployment-governance
boundedContext: deployment-governance
moduleRef: module-skill
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- DEPLOYMENT-GOVERNANCE-TECH-MODULE-SKILL
---

# `module-skill` TODO

## R2 scoped work

- [ ] 删除 Skill 中 `installClass/installRequires` 创建指导。
- [ ] 将 Platform 职责改为 discovery/aggregation/dispatch/ordering。
- [ ] 明确 Module owns config/status/validate/lifecycle truth。
- [ ] 明确 package manager owns dependency mutation。
- [ ] 删除 package-local single install 指导。
- [ ] config-bearing Module 强制配置知识完整性。

## Acceptance

Skill 不再生成或推荐已删除的 Platform CLI/Deployment Engine 用户流程。

## Boundary

不创造新 Domain/Capability，不修业务领域实现。

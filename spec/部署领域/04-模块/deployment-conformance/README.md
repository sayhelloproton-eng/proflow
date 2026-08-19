---
docId: DEPLOYMENT-GOVERNANCE-MODULE-DEPLOYMENT-CONFORMANCE
title: '`deployment-conformance` Module'
docType: module-index
authority: normative
lifecycle: active
domain: deployment-governance
boundedContext: deployment-governance
moduleRef: deployment-conformance
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- DEPLOYMENT-DEPLOYMENT-CONFORMANCE-TECH-DESIGN
---

# `deployment-conformance` Module

## Purpose

Conformance 是 Module Governance 的机械门，只验证当前薄 Platform 所依赖的公开事实一致性。

## Current conformance surface

- package identity 与 `package.json.proflow.module/descriptor`；
- static `proflow.module.json` 与 runtime descriptor 一致；
- `moduleRef/packageName/version/kind`；
- Runtime `provides/requires`；
- `configSlots/documentation`；
- Module status observation shape；
- 真实适用的 lifecycle declaration/adapter；
- config-bearing Module 的配置指导。

明确不再验证：

```text
installClass
installRequires / install closure
Core guard
package-owned self install
Platform plan/apply/verify/doctor/manifest
```

## Ownership

Conformance 可以使用 fake resource 验证 adapter contract，但不替代领域业务 E2E。Platform CLI 不因 conformance 增加 module-specific 业务逻辑。

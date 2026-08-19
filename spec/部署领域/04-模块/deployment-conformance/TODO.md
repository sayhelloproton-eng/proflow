---
docId: DEPLOYMENT-GOVERNANCE-TODO-DEPLOYMENT-CONFORMANCE
title: '`deployment-conformance` TODO'
docType: todo
authority: operational
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

# `deployment-conformance` TODO

## R2 scoped work

- [ ] 删除 installClass/installRequires/Core closure checks。
- [ ] 增加/归一 ModuleStatusObservation conformance。
- [ ] 校验 config-bearing Module documentation guidance。
- [ ] 保留 static descriptor ↔ runtime descriptor 一致性。
- [ ] 保留 Runtime provides/requires graph consistency。
- [ ] 更新 conformance tests，不恢复旧 Platform workflow。

## Acceptance

```text
active install closure conformance = 0
status shape mismatch = 0
config-bearing docs gap = 0
```

## Boundary

不扩展到业务领域 E2E/health 重新设计。

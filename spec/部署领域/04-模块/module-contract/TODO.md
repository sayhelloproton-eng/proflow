---
docId: DEPLOYMENT-GOVERNANCE-TODO-MODULE-CONTRACT
title: '`module-contract` TODO'
docType: todo
authority: operational
lifecycle: active
domain: deployment-governance
boundedContext: deployment-governance
moduleRef: module-contract
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- DEPLOYMENT-MODULE-CONTRACT-TECH-DESIGN
---

# `module-contract` TODO

> 本轮只记录 Platform CLI Surface Simplification 所需的 R2 工作，不恢复历史 backlog。

## R2 scoped work

- [ ] 从 `proflowPackageMetadataSchema` 删除 `installClass/installRequires`。
- [ ] 从 `moduleDescriptorSchema` 删除 `installClass`。
- [ ] 删除 compatibility 中 installClass comparison。
- [ ] 新增 `ModuleStatusObservation`：`configStatus/missingConfig?/runtimeStatus`。
- [ ] 保留 `provides/requires/configSlots/documentation` 当前合同。
- [ ] 更新 module-contract tests，使其证明新合同而不是旧 Core/install closure。

## Acceptance

```text
active installClass/installRequires schema = 0
status observation schema = typed + validated
missingConfig only when INCOMPLETE
runtime provides/requires semantics unchanged
```

## Stop rules

- 不借本轮修改业务 Domain Contract。
- 不为了旧测试保留已删除产品字段。
- 若需要领域重设计才能满足 contract，记录 `DOMAIN_BLOCKER` 并停止扩散。

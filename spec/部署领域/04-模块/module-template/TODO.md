---
docId: DEPLOYMENT-GOVERNANCE-TODO-MODULE-TEMPLATE
title: '`module-template` TODO'
docType: todo
authority: operational
lifecycle: active
domain: deployment-governance
boundedContext: deployment-governance
moduleRef: module-template
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- DEPLOYMENT-MODULE-TEMPLATE-TECH-DESIGN
---

# `module-template` TODO

## R2 scoped work

- [ ] 删除 `MaterializeModuleInput.installClass` 与 CLI `--install-class`。
- [ ] 删除 generated `installClass/installRequires`。
- [ ] 更新 `lifecycleByKind` 与 status skeleton，使其符合薄 Platform contract。
- [ ] 删除 generated package-owned self-install / install delegation。
- [ ] configSlots 非空时生成配置指导。
- [ ] 保持 `proflow.module.json` 与 runtime descriptor 同源。
- [ ] 更新 Template tests，只证明新治理表面。

## Acceptance

```text
new package emits no installClass/installRequires
new package has Module-owned status seam
config-bearing package has configuration guidance
no generated package-local platform install wrapper
```

## Boundary

不修改领域业务 API，不为旧测试恢复已删除字段。

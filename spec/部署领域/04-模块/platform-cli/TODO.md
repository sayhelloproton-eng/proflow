---
docId: DEPLOYMENT-GOVERNANCE-TODO-PLATFORM-CLI
title: '`platform-cli` TODO'
docType: todo
authority: operational
lifecycle: active
domain: deployment-governance
boundedContext: deployment-governance
moduleRef: platform-cli
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- DEPLOYMENT-PLATFORM-CLI-TECH-DESIGN
- DEPLOYMENT-DOC-02-01
---

# `platform-cli` TODO

> 当前唯一实施计划是 CLI Surface Simplification R1 → R2 → R3 → R4；完成后 STOP。

## R1 — Docs

- [ ] 所有权威文档切到六命令与 thin ownership。

## R2 — Module resources

- [ ] Contract 删除 installClass/installRequires，增加 typed status observation。
- [ ] Template/Skill/Conformance 对齐。
- [ ] 24/24 governed package metadata/descriptor/status/docs 对齐。

## R3 — CLI refactor

- [ ] package-manager primitive extraction。
- [ ] full-set install / package-only uninstall。
- [ ] workspace-local metadata。
- [ ] modules/docs aggregation。
- [ ] package-owned lifecycle dispatch。
- [ ] exactly six routable commands。
- [ ] zero-caller old engine deletion。

## R4 — Tests / acceptance

- [ ] 删除旧产品行为测试。
- [ ] 建六命令 targeted tests。
- [ ] 跑 narrow full gates。
- [ ] 跑 simulated human Golden Path。

## Final stop

```text
SIMULATED_HUMAN_E2E = PASS
READY_FOR_HUMAN_ACCEPTANCE = YES
→ STOP
```

任何非 Gate blocker 记录 `OUT_OF_SCOPE_DOMAIN`，不扩散。

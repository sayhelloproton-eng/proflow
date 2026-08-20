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

> 本轮只记录七标准管理面所需 R2 工作，不恢复历史 backlog。

## R2 scoped work

- [ ] 定义七标准能力：`install/uninstall/status/setup/docs/start/stop`。
- [ ] 删除标准 status 中的 `configStatus/missingConfig`。
- [ ] `runtimeStatus` 改为 `RUNNING|STOPPED|FAILED|NOT_APPLICABLE`。
- [ ] `configSlots` 只保留真正 public/user setup value；deterministic/private/shared-fact 不得暴露。
- [ ] 标准知识文档固定 `DOCS.md/SETUP.md`。
- [ ] 保留 `provides/requires` runtime Contract semantics。
- [ ] 更新 compatibility/conformance tests，删除旧 preflight/verification lifecycle 假设。

## Acceptance

```text
seven standard capabilities typed + validated
configStatus/missingConfig schema = 0
setupStatus/runtimeStatus schema = typed + validated
DOCS/SETUP standard knowledge contract = frozen
runtime provides/requires semantics unchanged
```

## Stop rules

- 不借本轮修改业务 Domain Contract。
- 不为了旧测试保留已删除产品字段。
- 缺 Producer-owned shared fact 时记录 `SHARED_FACT_CONTRACT_MISSING` 并停止。
- 若需要领域重设计才能满足 contract，记录 `DOMAIN_BLOCKER` 并停止扩散。

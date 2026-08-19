---
docId: DEPLOYMENT-GOVERNANCE-MODULE-MODULE-SKILL
title: '`module-skill` Module'
docType: module-index
authority: normative
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

# `module-skill` Module

## Purpose

`module-skill` 是 AI 创建/维护 ProFlow Module 的治理技能。它只消费当前 Contract/Template/Conformance 与六命令产品真源，不复制 Platform 或领域知识。

## Frozen ownership

```text
Module = config/status/validate/lifecycle truth
Platform CLI = discovery/aggregation/dispatch/ordering
Package manager = npm dependency mutation
```

Skill 不再指导 AI 创建 `installClass/installRequires`、Plan/Apply/Verify/Doctor 或 package-owned 单包 install。

## Creation flow

```text
read owner facts
→ use module-template
→ fill Module-owned descriptor/adapter/docs
→ run deployment-conformance
→ release package
```

configSlots 非空时必须提供足够 `CONFIGURATION.md` 指导，确保 AI 能通过 `platform docs` 理解并完成配置。

## Boundary

不得 invent capability/dependency/permission/owner/domain/lifecycle；缺少 owner fact 时 fail-closed，而不是让 Platform CLI 补业务逻辑。

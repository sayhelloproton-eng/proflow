---
docId: DEPLOYMENT-GOVERNANCE-TECH-MODULE-SKILL
title: '`module-skill` Technical Design Index'
docType: module-design-index
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

# `module-skill` 详细技术方案

## 1. 角色

Skill 负责把已经冻结的 Module owner facts 落到标准 package 结构，并调用 Template/Conformance；不负责重新设计 Platform CLI 或领域业务。

## 2. 必须使用的当前合同

- 所有 governed Module 提供 `install/uninstall/status/setup/docs/start/stop`；
- `provides/requires` 表示 Module topology / Contract dependency；
- deterministic private config 由 `Module.install` 自闭环；
- Producer-owned shared fact 不经 Platform config bus；
- 用户选择/外部现实由 `Module.setup` 引导；
- `Module.status` 是唯一 management state truth；
- 标准知识文档只有 `DOCS.md` 与 `SETUP.md`。

## 3. 禁止生成

```text
platform modules / plan / apply / upgrade / preflight / verify / doctor / manifest
CONFIGURATION.md as standard guidance
configStatus / missingConfig management status
createProductionBinding(configByModuleRef)
Platform-owned business health/config checks
```

## 4. Extra capability

Module-specific extra command 允许存在；Skill 只要求它属于 Module 自身业务或稳定 Contract，Platform 不代理、不理解。

## 5. Maintenance

Owner 修改 descriptor/adapter/status/setup/docs 后，同步 root manifest 与标准文档并重新运行 conformance。

若适配七能力必须修改领域业务 API、状态机、service 算法，立即退出 Skill 范围并返回 `OUT_OF_SCOPE_DOMAIN`；若缺 Producer-owned shared fact，返回 `SHARED_FACT_CONTRACT_MISSING`，不得让 Platform 代传私有配置。

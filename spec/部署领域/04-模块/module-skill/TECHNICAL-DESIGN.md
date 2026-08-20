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
- 用户选择/外部现实由 `Module.setup` 引导；setup 必须先自动完成所有可自动步骤，只返回最小真实人工动作；
- `SETUP.md` 必须是最短闭环 Step，每个推进步骤都具备 package-owned executable/verify；
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

## 5. Setup closure rule

Skill 在生成/迁移 Module 时必须机械检查：

```text
当前 setupStatus 如何观测？
哪些步骤机器自己可以完成？ → 自动化
哪些值来自 Producer？ → shared fact / Contract
哪些动作真的必须由用户完成？ → 最小 ACTION_REQUIRED
每个人工动作如何 prepare？ → package-owned executable
完成后如何 verify？ → package-owned executable
最终如何证明 READY？ → Module.status
```

如果 `SETUP.md` 只有说明文字、要求用户手工搬内部 path/token/endpoint、或人工完成后没有 package-owned verification，视为 setup 未闭环。Skill 应先修 owner seam，而不是把复杂度推给 Platform 或用户。

## 6. Maintenance

Owner 修改 descriptor/adapter/status/setup/docs 后，同步 root manifest 与标准文档并重新运行 conformance。

若适配七能力必须修改领域业务 API、状态机、service 算法，立即退出 Skill 范围并返回 `OUT_OF_SCOPE_DOMAIN`；若缺 Producer-owned shared fact，返回 `SHARED_FACT_CONTRACT_MISSING`，不得让 Platform 代传私有配置。

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

Conformance 是 Module Governance 的机械门，只验证七命令 Platform 所依赖的公开治理事实，不证明领域业务 E2E。

## Current conformance surface

- package identity 与最小 `package.json.proflow`；
- static `proflow.module.json` 与 runtime descriptor 一致；
- `moduleRef/packageName/version/kind/platformCompatibility`；
- `provides/requires` topology；
- 七标准 adapter commands；
- `setupStatus/runtimeStatus` shape；
- `DOCS.md` 与 `SETUP.md`；
- `SETUP.md` 最短闭环结构与 package-owned executable/verify guidance。

允许 Module-specific extra capability，不要求 Platform 代理。

明确不再验证：

```text
installClass / installRequires / install closure
CONFIGURATION.md as standard guidance
configStatus / missingConfig
createProductionBinding / configByModuleRef
preflight / verify / doctor / restart as standard management lifecycle
service public start CLI as universal requirement
```

## Ownership

Conformance 可以使用 fake resource 验证 adapter contract，但不得迫使 production 代码保留已删除产品概念，也不得为了 gate 修改 Browser/Model/Gateway/Task/Agent 业务语义。它可以机械检查 setup guidance 是否可执行：不能只有 prose、不能要求用户搬 deterministic/private/shared-fact 值、人工步骤必须有 owner-owned verify 路径。
## Setup Closure Conformance

Conformance 必须机械证明 setup 结构可被薄 Platform 全量聚合：每个需要 setup 的 Module 有最短 `SETUP.md` Step；每个状态推进 Step 声明 package-owned executable/verify 与 Success Condition；`ACTION_REQUIRED` 只用于真实人工/外部动作。`platform setup` 可一次遍历全部 discovered Module，READY 跳过，所有非 READY 继续执行并一次性聚合，而不需要 Platform 理解 Module 私有配置或步骤。

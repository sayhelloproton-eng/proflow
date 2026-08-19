---
docId: DEPLOYMENT-GOVERNANCE-MODULE-REGISTRY
title: 部署领域｜Module Registry
docType: module-registry
authority: normative
lifecycle: active
domain: deployment-governance
canonicalFor:
- deployment-governance.module-registry
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs: []
---

# 部署领域｜Module Registry

> Module 是治理身份，不自动等于 Service 或 Process；Package 自己拥有状态、配置与生命周期真相，Platform 只聚合/分发。

| moduleRef | package | kind | technical docs |
|---|---|---|---|
| `module-contract` | `@tomflow/proflow-module-contract` | library | [module-contract](./module-contract/README.md) |
| `module-template` | `@tomflow/proflow-module-template` | library | [module-template](./module-template/README.md) |
| `deployment-conformance` | `@tomflow/proflow-deployment-conformance` | library/cli | [deployment-conformance](./deployment-conformance/README.md) |
| `platform-cli` | `@tomflow/proflow-platform-cli` | cli-app | [platform-cli](./platform-cli/README.md) |
| `module-skill` | `@tomflow/proflow-module-skill` | agent-skill | [module-skill](./module-skill/README.md) |

## 规则

- Runtime cross-module dependency 只通过 `provides/requires`；npm dependency 由 package manager 负责。
- Library 不伪造 lifecycle。
- Service/External Resource 只暴露真实拥有的 status/validate/start/stop。
- Platform CLI 不实现 Module 私有验证/health/config truth。
- Config-bearing Module 必须提供足够的静态配置指导。
- 不存在 Core/installRequires 安装模型，也不存在 package-owned 单包 install 产品入口。

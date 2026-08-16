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

## Identity

```text
Domain: deployment-governance
Bounded Context: deployment-governance
moduleRef: deployment-conformance
package: @tomflow/proflow-deployment-conformance
kind: cli
installClass: core
service: none
```

## Purpose

Deployment Conformance 是 Module Governance 强制门。它验证一个 package 是否具备被 Registry/Workspace Discovery、Platform CLI lifecycle 和 AI docs aggregation 稳定消费的真实形式；不替代业务领域测试。

## Gates

### C1 Static Contract

验证 Descriptor：identity/installClass/Provides/Requires/requirements/config/lifecycle/verification/effects cleanup/documentation。

### C2 Package

验证 package identity/exports、`package.json.proflow`、Descriptor 一致性、package-owned docs、build/public entry 与 secret/publishability 基础。

### C3 Behavior

验证声明的 lifecycle/Adapter 使用 structured result，且不伪造 unsupported lifecycle 或超出 effect ownership 的 cleanup。

## Canonical technical docs

- [TECHNICAL-DESIGN.md](TECHNICAL-DESIGN.md)
- [module-contract/TECHNICAL-DESIGN.md](../module-contract/TECHNICAL-DESIGN.md)
- [module-template/TECHNICAL-DESIGN.md](../module-template/TECHNICAL-DESIGN.md)

## Boundary

Conformance 不查询 Registry 可安装集合、不执行 package manager install/remove、不拥有业务文档内容。它只证明 package 形式与声明行为符合统一 Contract。

## Testing

当前 Real-1 blocker 整改先更新实现和人工真实验证；正式自动化测试用例/evidence 在人工验证通过后再更新。

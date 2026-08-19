---
docId: DEPLOYMENT-GOVERNANCE-MODULE-MODULE-CONTRACT
title: '`module-contract` Module'
docType: module-index
authority: normative
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

# `module-contract` Module

## Identity

```text
moduleRef: module-contract
package: @tomflow/proflow-module-contract
kind: library
```

## Purpose

`module-contract` 是 Module Governance 的形式真源，只定义被 Platform、Template、Conformance 与 AI 共同消费的稳定 schema，不承载业务 Module 实现。

当前最小合同覆盖：

- Module identity / kind / version / compatibility；
- 轻量 `package.json.proflow` discovery metadata；
- Runtime `provides/requires`；
- `configSlots` 与 documentation；
- Module-owned lifecycle declaration/result；
- Module-owned status observation：`configStatus/missingConfig?/runtimeStatus`。

明确删除：`installClass`、`installRequires`、Core/Optional 安装分类。

## Ownership

```text
Module owns logic and truth.
Platform CLI owns discovery / aggregation / dispatch / ordering.
Package manager owns npm dependency operations.
```

`provides/requires` 不参与 npm install ordering。

## Lifecycle

Library 不伪造 start/stop。运行型 Module 只声明自己真实支持的 `status/preflight/start/stop` 等 primitive；Platform 只分发，不实现私有检查。

## Documentation

每个 Module 自己拥有配置和使用知识；Contract 只定义索引结构。Config-bearing Module 必须提供足够配置指导。

## Technical docs

- [TECHNICAL-DESIGN.md](TECHNICAL-DESIGN.md)
- [00-五包架构与Module治理模型.md](../00-五包架构与Module治理模型.md)

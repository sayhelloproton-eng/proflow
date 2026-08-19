---
docId: DEPLOYMENT-GOVERNANCE-MODULE-MODULE-TEMPLATE
title: '`module-template` Module'
docType: module-index
authority: normative
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

# `module-template` Module

## Identity

```text
moduleRef: module-template
package: @tomflow/proflow-module-template
kind: library
```

## Purpose

统一生成符合当前 Module Contract 的 package 骨架，使新增 Module 无需修改 Platform CLI。

生成目标包括：

- `package.json.proflow` 最小 discovery metadata；
- `proflow.module.json` / runtime descriptor；
- adapter 与真实适用的 `status/preflight/start/stop` 资源；
- `provides/requires/configSlots/documentation`；
- configSlots 非空时生成配置指导。

明确不生成：`installClass`、`installRequires`、Core/Optional 分类、package-owned 单包 install delegation。

## Stable create entry

Template 继续提供 `materializeModule()` 与稳定 create CLI；二者共用同一实现。

## Boundary

Template 只生成治理形式，不猜领域 API/permission/业务状态。Service/Browser/External Resource 的真实生命周期与状态判断必须由 package owner 实现。

## Technical docs

- [TECHNICAL-DESIGN.md](TECHNICAL-DESIGN.md)
- [00-五包架构与Module治理模型.md](../00-五包架构与Module治理模型.md)

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

`module-contract` 是 Module Governance 的形式真源，只定义 Platform、Template、Conformance 与 Module 共同消费的稳定合同，不承载业务实现。
## Frozen standard surface

所有 governed Module 必须提供同一组标准管理能力：

```text
install
uninstall
status
setup
docs
start
stop
```

这七个能力是最低管理合同，不是 Module 能力上限。Module-specific extra command 可以继续存在，但 Platform 不代理、不解释。

## Frozen status truth

```text
setupStatus   = READY | ACTION_REQUIRED | FAILED
runtimeStatus = RUNNING | STOPPED | FAILED | NOT_APPLICABLE
```

`status` 必须由 Module 自己观察真实状态得出。`configStatus/missingConfig` 不再属于标准 status。

## Config / shared fact

- Module 能唯一确定的值：`install` 自闭环；
- 跨 Module 值：Producer-owned Contract/shared fact；
- 用户选择或外部现实：`setup`；
- `configSlots` 只允许描述真正公开的用户 setup 值，不能承载 deterministic/private/shared-fact 配置。
## Standard knowledge

标准知识文件只保留：

```text
DOCS.md
SETUP.md
```

`DOCS.md` 解释 Module 能力/API/Contract；`SETUP.md` 解释 install 之后仍需用户或外部世界完成的步骤。Schema 不是第三份指导文档。

## Ownership

```text
Module owns logic and truth.
Platform owns discovery / ordering / forwarding / aggregation.
Package manager owns npm dependency mutation.
```

Library 也实现七标准能力；没有独立 runtime 时 `start/stop` 为标准 no-op，`runtimeStatus=NOT_APPLICABLE`。

## Technical docs

- [TECHNICAL-DESIGN.md](TECHNICAL-DESIGN.md)
- [00-五包架构与Module治理模型.md](../00-五包架构与Module治理模型.md)

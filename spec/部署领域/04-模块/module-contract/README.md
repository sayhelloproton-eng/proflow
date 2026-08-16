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
Domain: deployment-governance
Bounded Context: deployment-governance
moduleRef: module-contract
package: @tomflow/proflow-module-contract
kind: library
installClass: core
service: none
process/deployment: none / determined by Deployment kind
```

## Purpose

`module-contract` 是 ProFlow Module 治理的形式真源。它定义 Platform CLI、Module Template、Conformance 与 AI 开发流程共同消费的稳定 runtime schema，不承载具体业务 Module 的实现或知识副本。

当前正式合同覆盖：

- Module identity / kind / version / compatibility；
- npm package discovery metadata 与 `core | optional` install class；
- logical Provides / Requires；
- runtime/executable/filesystem/network/module/human requirements；
- Config Slots；
- lifecycle support，包括 package-owned `uninstall` cleanup capability；
- Verification；
- Effects ownership 与 `remove | preserve | explicit-purge` cleanup policy；
- AI-readable Module identity 与 documentation entries；
- structured deployment result/error。

## Canonical technical docs

- [TECHNICAL-DESIGN.md](TECHNICAL-DESIGN.md)
- [00-五包架构与Module治理模型.md](../00-五包架构与Module治理模型.md)
- [INSTALL 与 AI-native Deployment](../../05-#U8d28#U91cf#U4e0e#U90e8#U7f72/01-INSTALL#U4e0eAI-native#U90e8#U7f72.md)

## Public Contract / Dependencies

- npm `dependencies` 表达真实 package install dependency；Module `Provides/Requires` 表达逻辑 contract dependency，两者不得混用。
- Platform CLI 的 Registry Discovery/Workspace Discovery 只消费本合同，不由 `module-contract` 自身执行 Registry 查询。
- 跨域只通过 Public Contract / logical Provides-Requires。
- 禁止读取其他领域 DB、Repository、内部 Adapter 或 deep import。

## Runtime / Lifecycle

- `library` 不伪造 start/stop/restart。
- Module 只声明自己真实支持的 lifecycle primitive；Platform CLI 对 unsupported lifecycle 必须明确跳过/报告，不伪造成功。
- `uninstall` 只表示 package-owned cleanup lifecycle；npm package remove、core guard、依赖排序与 Workspace reconciliation 仍由 Platform CLI 负责。
- core Module 当前阶段禁止单包 uninstall。

## AI / Documentation

每个业务 Module 自己拥有领域职责、Provides/Requires、commands/APIs 与详细 docs。`module-contract` 只定义稳定索引格式；Platform CLI 负责聚合当前真实安装版本的 package-owned Descriptor/Docs。

## Testing

正式自动化测试用例/证据在本轮人工真实验证通过后再更新；当前实现与文档修复阶段不提前改写测试真源。

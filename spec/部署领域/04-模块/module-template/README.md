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
Domain: deployment-governance
Bounded Context: deployment-governance
moduleRef: module-template
package: @tomflow/proflow-module-template
kind: library
installClass: core
service: none
process/deployment: none
```

## Purpose

`module-template` 是新 ProFlow Module 的统一工程生成器。它不拥有业务领域知识，而是把 `module-contract` 的治理形式机械落成六种 profile 的 package 骨架。

新包通过 Template 创建后应天然具备：

- npm package 基线与 `package.json.proflow` discovery metadata；
- Module Descriptor / Adapter / Requirements / Verification；
- `core | optional` install class；
- domain/summary/docs 自描述入口；
- effects/cleanup retention 骨架；
- conformance 配置；
- package-owned README；
- 对应 Kind 的最小真实 lifecycle shape。

## Stable create entry

Template 同时提供 library API `materializeModule()` 与唯一稳定 CLI/bin；两者必须使用同一实现：

```text
npx @tomflow/proflow-module-template create ...
```

AI 应由 `module-skill` 读取领域 frozen facts 后调用该入口，不应手工复制模板目录。

## Canonical technical docs

- [TECHNICAL-DESIGN.md](TECHNICAL-DESIGN.md)
- [00-五包架构与Module治理模型.md](../00-五包架构与Module治理模型.md)

## Boundary

- Template 只生成形式，不猜 `domain/installClass/Provides/Requires/API/permission`。
- Library 不伪造服务生命周期。
- External resource / Browser / Agent carrier 的远端或用户状态不做默认 destructive cleanup。
- 领域具体实现完成后必须进入 Deployment Conformance。

## Testing

当前 Real-1 blocker 整改阶段不改正式测试用例；人工真实创建/安装验证通过后再补自动化测试与 evidence。

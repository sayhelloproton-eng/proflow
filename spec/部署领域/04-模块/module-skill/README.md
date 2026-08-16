---
docId: DEPLOYMENT-GOVERNANCE-MODULE-MODULE-SKILL
title: '`module-skill` Module'
docType: module-index
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

# `module-skill` Module

## Identity

```text
Domain: deployment-governance
Bounded Context: deployment-governance
moduleRef: module-skill
package: @tomflow/proflow-module-skill
runtime kind: library
product/document taxonomy: agent-skill
installClass: core
service: none
process/deployment: none
```

`agent-skill` 是产品/文档 taxonomy；runtime `ModuleDescriptor.kind` 继续使用既有 `library`。当前不为 Skill 新增第二种 runtime ModuleKind。

## Purpose

Module Skill 是 AI 创建/维护 ProFlow Module 的标准操作方法：读取 Owner frozen facts，调用 Module Template 稳定 CLI 创建 profile 骨架，填写领域真实内容，再通过 Deployment Conformance。

它不维护 package scaffold、不拥有业务知识、不执行平台生命周期。

## Canonical technical docs

- [TECHNICAL-DESIGN.md](TECHNICAL-DESIGN.md)
- [module-template/TECHNICAL-DESIGN.md](../module-template/TECHNICAL-DESIGN.md)
- [00-五包架构与Module治理模型.md](../00-五包架构与Module治理模型.md)

## Standard create boundary

Skill 创建新 Module 前必须得到：

```text
moduleRef
packageName
kind
installClass
domain
summary
```

然后机械调用：

```text
npx @tomflow/proflow-module-template create ...
```

Template 负责形式；Owner 负责 Provides/Requires/API/config/lifecycle/effects/docs；Conformance 负责验收。

缺 Owner facts 时 STOP，不允许 AI 通过名字或相邻 Module 推断。

## Runtime / Lifecycle

Skill runtime descriptor 为 library；不伪造 start/stop。Platform install/start/stop/status/docs 等由 Platform CLI 统一治理。

## Testing

当前先人工验证真实 Skill → Template CLI → 新包创建路径；正式自动化测试用例与 evidence 在人工验证通过后再更新。

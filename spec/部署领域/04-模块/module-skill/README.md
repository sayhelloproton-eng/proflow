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
kind: agent-skill
service: none
process/deployment: none / determined by Deployment kind
```

## Purpose

本 README 是该 Module 的导航入口；正式业务与工程事实由本 Module 技术设计及所属领域 Contract/Flow 共同定义，不维护第二套重复事实。

## Canonical technical docs

- [00-五包架构与Module治理模型.md](../00-五包架构与Module治理模型.md)
- [01-INSTALL与AI-native部署.md](../../05-质量与部署/01-INSTALL与AI-native部署.md)
- [03-新仓库实施顺序-停止门与非目标.md](../../05-质量与部署/03-新仓库实施顺序-停止门与非目标.md)

## Public Contract / Dependencies

- 使用本领域 `02-契约/` 的 Public Contract。
- 跨域只通过 Public Contract / logical Provides-Requires。
- 禁止读取其他领域 DB、Repository、内部 Adapter 或 deep import。

## Runtime / Lifecycle

> **Batch 6 taxonomy clarification**：`agent-skill` 是文档/产品语义 taxonomy；`module-contract` 当前冻结的 runtime `ModuleDescriptor.kind` 不包含 `agent-skill`，因此 `@tomflow/proflow-module-skill` 的 runtime descriptor 必须继续使用 `library`。这不是第二种 ModuleKind，也不允许为本澄清修改冻结 contract enum。

- **Batch 6 taxonomy clarification**：文档/Registry 的语义 taxonomy 仍为 `agent-skill`；`module-contract` 的 runtime `ModuleDescriptor.kind` 枚举不新增 `agent-skill`，因此 `@tomflow/proflow-module-skill` 的可执行 descriptor 继续使用 `kind: library`。这是 semantic taxonomy 与 runtime contract kind 的两层表达，不是两个 Module，也不修改 Frozen contract 枚举。
- `agent-skill` 的真实 lifecycle 由 Module 自身声明并由 Deployment Domain 治理。
- Library 不伪造 start/stop。
- Service/Process 的启动、关闭、health、recovery 以对应 TECHNICAL-DESIGN 与 Deployment requirements 为准。

## Testing

见本领域 `05-质量与部署/` 和本 Module `TODO.md` 的 acceptance/verification。

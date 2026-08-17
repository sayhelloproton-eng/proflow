---
docId: DEPLOYMENT-GOVERNANCE-MODULE-PLATFORM-CLI
title: '`platform-cli` Module'
docType: module-index
authority: normative
lifecycle: active
domain: deployment-governance
boundedContext: deployment-governance
moduleRef: platform-cli
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- DEPLOYMENT-PLATFORM-CLI-TECH-DESIGN
- DEPLOYMENT-DOC-02-01
---

# `platform-cli` Module

## Identity

```text
Domain: deployment-governance
Bounded Context: deployment-governance
moduleRef: platform-cli
package: @tomflow/proflow-platform-cli
kind: cli-app
service: none
process/deployment: platform-cli
```

## Purpose

本 README 是该 Module 的导航入口；正式业务与工程事实由本 Module 技术设计及所属领域 Contract/Flow 共同定义，不维护第二套重复事实。

Platform CLI 同时聚合两类互不替代的 reality：npm Registry 中的可安装 ProFlow Module，以及 global binding 指向的唯一 `boundWorkspace` 中真实已安装、必须统一治理的 Managed Module。绑定建立后，调用者当前 cwd 不改变 Managed World；只有首次 `platform install` 的 cwd / `--workspace <path>` 用于选择 requested Workspace。Fresh Workspace 不要求预先存在任何 ProFlow dependency。

面向 AI 的能力发现不由 Platform CLI 手写包说明：`platform modules` 给出当前 Managed Module 集合，`platform docs` 聚合各包自己的 Descriptor + npm `bin/exports` + documentation，`platform docs <module> <documentId>` 只读取该包声明的文档正文。

## Canonical technical docs

- [TECHNICAL-DESIGN.md](TECHNICAL-DESIGN.md)
- [01-Deployment-Plan-Apply-ACTION_REQUIRED与恢复.md](../../03-流程与数据/01-Deployment-Plan-Apply-ACTION_REQUIRED与恢复.md)
- [03-Verify-Doctor-Manifest与Platform-READY.md](../../03-流程与数据/03-Verify-Doctor-Manifest与Platform-READY.md)

## Public Contract / Dependencies

- 使用本领域 `02-契约/` 的 Public Contract。
- 跨域只通过 Public Contract / logical Provides-Requires。
- 禁止读取其他领域 DB、Repository、内部 Adapter 或 deep import。

## Runtime / Lifecycle

- `cli-app` 的真实 lifecycle 由 Module 自身声明并由 Deployment Domain 治理。
- Library 不伪造 start/stop。
- Service/Process 的启动、关闭、health、recovery 以对应 TECHNICAL-DESIGN 与 Deployment requirements 为准。

## Testing

见本领域 `05-质量与部署/` 和本 Module `TODO.md` 的 acceptance/verification。

---
docId: EXECUTION-MODULE-EXECUTION-CONTRACTS
title: '`execution-contracts` Module'
docType: module-index
authority: normative
lifecycle: active
domain: execution
boundedContext: execution
moduleRef: execution-contracts
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- EXECUTION-TECH-EXECUTION-CONTRACTS
- EXECUTION-DOC-02-01
- EXECUTION-DOC-02-02
---

# `execution-contracts` Module

## Identity

```text
Domain: execution
Bounded Context: execution
moduleRef: execution-contracts
package: @tomflow/proflow-execution-contracts
kind: library
service: none
process/deployment: none / determined by Deployment kind
```

## Purpose

本 README 是该 Module 的导航入口；正式业务与工程事实由本 Module 技术设计及所属领域 Contract/Flow 共同定义，不维护第二套重复事实。

## Canonical technical docs

- [01-Public-Contract与TypeScript类型规范.md](../../02-契约/01-Public-Contract与TypeScript类型规范.md)
- [00-总体架构-包-服务-运行拓扑.md](../00-总体架构-包-服务-运行拓扑.md)

## Public Contract / Dependencies

- 使用本领域 `02-契约/` 的 Public Contract。
- 跨域只通过 Public Contract / logical Provides-Requires。
- 禁止读取其他领域 DB、Repository、内部 Adapter 或 deep import。

## Runtime / Lifecycle

- `library` 的真实 lifecycle 由 Module 自身声明并由 Deployment Domain 治理。
- Library 不伪造 start/stop。
- Service/Process 的启动、关闭、health、recovery 以对应 TECHNICAL-DESIGN 与 Deployment requirements 为准。

## Testing

见本领域 `05-质量与部署/` 和本 Module `TODO.md` 的 acceptance/verification。

## 2026-08-14 Contract alignment

The contract surface now explicitly separates `ArtifactRef` from `EvidenceRef`: artifacts identify bounded materialized inputs/outputs such as Context Pack/Patch/report/download; evidence proves Result/Delivery/Effect. Browser Carrier operations remain typed Execution capabilities/results and must not introduce frame/persistent-tab business identity or Observer business-write contracts.

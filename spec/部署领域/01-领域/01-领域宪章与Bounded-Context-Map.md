---
docId: DEPLOYMENT-GOVERNANCE-CHARTER
title: 部署领域｜领域宪章与 Bounded Context Map
docType: domain-charter
authority: normative
lifecycle: active
domain: deployment-governance
boundedContext: deployment-governance
canonicalFor:
- deployment-governance.boundary
- deployment-governance.bounded-context-map
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs: []
---

# 部署领域｜领域宪章与 Bounded Context Map

## 1. Purpose

统一 Module Contract、Template、Conformance、Registry/Workspace discovery、七标准管理能力、External Resource setup 与版本治理。

## 2. Owns

- Module governance / Contract / Template / Conformance
- Platform `install/uninstall/status/setup/docs/start/stop`
- Registry / package-manager orchestration
- Module topology ordering
- ACTION_REQUIRED 的标准返回语义
- upgrade/template migration 的工程一致性

## 3. Does Not Own

- Task workflow / Agent Role/Worker / Execution effect policy / Model reasoning semantics
- 其他领域业务健康真源
- Module 私有 config/runtime composition
- Module-specific extra command 语义

## 4. 主 Bounded Context

```text
deployment-governance
```

当前设计围绕一个统一 Module Governance 模型工作，五个 package 是工程实现分工而非五个业务模型边界。

禁止：`package == Bounded Context`、`service == Bounded Context`、`folder == Bounded Context`。

## 5. Bounded Context → Module

| Module | Package | Kind |
|---|---|---|
| `module-contract` | `@tomflow/proflow-module-contract` | library |
| `module-template` | `@tomflow/proflow-module-template` | library |
| `deployment-conformance` | `@tomflow/proflow-deployment-conformance` | library/cli |
| `platform-cli` | `@tomflow/proflow-platform-cli` | cli-app |
| `module-skill` | `@tomflow/proflow-module-skill` | agent-skill |

## 6. Public Boundary

Provides：Module governance contract、七标准 management capability contract、generic status/setup result semantics、conformance。

Requires：所有正式 Module descriptor/adapter、Producer-owned shared facts、External Resource 自己的 setup/status/docs 能力。

跨域依赖必须经过 Public Contract；禁止读取其他领域 DB、Repository、内部 Adapter 或 deep import。

## 7. 详细模型与边界正文

本文件只冻结 DDD 导航边界；详细定义继续由本领域 `01-领域/02-*`、`01-领域/03-*` 和 `02-契约/*` 承载。

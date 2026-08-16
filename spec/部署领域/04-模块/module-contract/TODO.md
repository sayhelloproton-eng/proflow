---
docId: DEPLOYMENT-GOVERNANCE-TODO-MODULE-CONTRACT
title: '`module-contract` TODO'
docType: todo
authority: operational
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
# `module-contract` TODO

> 本文件是该 Module 的当前实施 backlog。`Status: READY` 保留原任务事实，表示任务已进入当前 backlog；`implementationReadiness: PLANNED` 表示**尚未冻结自动施工顺序**。Priority、dependsOn、逐任务 acceptance/verification 不允许由文档整理工具推断；没有可直接追溯的冻结依据时，分别保持 `PENDING_DECISION`、`NOT_FROZEN`、`ACCEPTANCE_NOT_FROZEN` / `verification: []`。

## Implementation Tasks
### DPL-CON-001

```yaml
id: DPL-CON-001
status: READY
implementationReadiness: PLANNED
priority: PENDING_DECISION
type: CONTRACT
owner:
  domain: deployment-governance
  boundedContext: deployment-governance
  moduleRef: module-contract
sourceRefs:
- DEPLOYMENT-MODULE-CONTRACT-TECH-DESIGN
qualityRefs:
- DEPLOYMENT-DOC-05-02
dependencyState: NOT_FROZEN
dependsOn: []
goal: 冻结 Module/Provides/Requires/ConfigSlot/Lifecycle/Verify/Doctor schema
scope:
  allow:
  - packages/module-contract/**
  forbid:
  - 其他 Domain 的业务 Store/Repository
  - 其他领域内部实现的 deep import
  - 任何未经 Contract Change 的 Domain/Bounded Context/Service/Public Contract 变更
acceptance:
- ACCEPTANCE_NOT_FROZEN
verification: []
evidence: []
```

### DPL-CON-002

```yaml
id: DPL-CON-002
status: READY
implementationReadiness: PLANNED
priority: PENDING_DECISION
type: IMPLEMENTATION
owner:
  domain: deployment-governance
  boundedContext: deployment-governance
  moduleRef: module-contract
sourceRefs:
- DEPLOYMENT-MODULE-CONTRACT-TECH-DESIGN
qualityRefs:
- DEPLOYMENT-DOC-05-02
dependencyState: NOT_FROZEN
dependsOn: []
goal: 覆盖 external-resource/moduleRef/secretRef 等 kind/type
scope:
  allow:
  - packages/module-contract/**
  forbid:
  - 其他 Domain 的业务 Store/Repository
  - 其他领域内部实现的 deep import
  - 任何未经 Contract Change 的 Domain/Bounded Context/Service/Public Contract 变更
acceptance:
- ACCEPTANCE_NOT_FROZEN
verification: []
evidence: []
```

### DPL-CON-003

```yaml
id: DPL-CON-003
status: READY
implementationReadiness: PLANNED
priority: PENDING_DECISION
type: VALIDATION
owner:
  domain: deployment-governance
  boundedContext: deployment-governance
  moduleRef: module-contract
sourceRefs:
- DEPLOYMENT-MODULE-CONTRACT-TECH-DESIGN
qualityRefs:
- DEPLOYMENT-DOC-05-02
dependencyState: NOT_FROZEN
dependsOn: []
goal: 完成 schema validation 与 backward compatibility tests
scope:
  allow:
  - packages/module-contract/**
  forbid:
  - 其他 Domain 的业务 Store/Repository
  - 其他领域内部实现的 deep import
  - 任何未经 Contract Change 的 Domain/Bounded Context/Service/Public Contract 变更
acceptance:
- ACCEPTANCE_NOT_FROZEN
verification: []
evidence: []
```

## Stop Rules

- `implementationReadiness != READY_TO_IMPLEMENT` 时，Codex/Agent 不得把 TODO 当作自动施工队列；先完成实施编排。
- 不得通过 TODO 创造新 Domain/Bounded Context/Service。
- 不得 deep import 其他领域内部实现或直接读写其他领域 Store。
- `PENDING_SPIKE` 不转成 IMPLEMENTATION 任务，除非先完成验证并更新正式状态。
- 发现正式文档内部冲突时停止实现，先修 Contract/Design。

## Current Real-1 remediation delta (2026-08-16)

本节记录当前 Fresh Workspace / Platform Install blocker 暴露出的 `module-contract` 形式补齐，不改写上方历史 backlog 状态字段。

```yaml
remediationRef: REAL1-FRESH-WORKSPACE-MODULE-CONTRACT
status: IMPLEMENTATION_IN_PROGRESS
scope:
  - npm package discovery metadata schema
  - installClass: core | optional
  - Module identity/domain/summary self-description
  - package-owned documentation entry
  - lifecycle uninstall capability
  - effect cleanup retention: remove | preserve | explicit-purge
  - CORE_PACKAGE_REQUIRED / UNINSTALL_FAILED error semantics
outOfScope:
  - core implementation replacement
  - generic npm marketplace/plugin registry
  - business-domain implementation changes
testPolicy:
  automatedTestCaseChanges: DEFERRED_UNTIL_MANUAL_REAL_VALIDATION
```

当前代码与规范先完成闭环；人工 Real-1 验证通过后，再更新正式测试用例与 evidence。

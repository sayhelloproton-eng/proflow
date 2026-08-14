---
docId: EXECUTION-TODO-EXECUTION-BROWSER-EXTENSION
title: '`execution-browser-extension` TODO'
docType: todo
authority: operational
lifecycle: active
domain: execution
boundedContext: execution
moduleRef: execution-browser-extension
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- EXECUTION-EXECUTION-BROWSER-EXTENSION-TECH-DESIGN
- EXECUTION-DOC-02-01
- EXECUTION-DOC-02-02
---
# `execution-browser-extension` TODO

> 本文件是该 Module 的当前实施 backlog。`Status: READY` 保留原任务事实，表示任务已进入当前 backlog；`implementationReadiness: PLANNED` 表示**尚未冻结自动施工顺序**。Priority、dependsOn、逐任务 acceptance/verification 不允许由文档整理工具推断；没有可直接追溯的冻结依据时，分别保持 `PENDING_DECISION`、`NOT_FROZEN`、`ACCEPTANCE_NOT_FROZEN` / `verification: []`。

## Implementation Tasks
### EXE-BR-001

```yaml
id: EXE-BR-001
status: READY
implementationReadiness: PLANNED
priority: PENDING_DECISION
type: IMPLEMENTATION
owner:
  domain: execution
  boundedContext: execution
  moduleRef: execution-browser-extension
sourceRefs:
- EXECUTION-EXECUTION-BROWSER-EXTENSION-TECH-DESIGN
- EXECUTION-DOC-02-01
- EXECUTION-DOC-02-02
qualityRefs:
- EXECUTION-DOC-05-02
dependencyState: NOT_FROZEN
dependsOn: []
goal: 实现 agentPackageRef+roleRef+workerRef+conversationLocator 稳定绑定与 transient tab/content identity；禁止 frame/persistent-tab business identity
scope:
  allow:
  - packages/execution-browser-extension/**
  forbid:
  - 其他 Domain 的业务 Store/Repository
  - 其他领域内部实现的 deep import
  - 任何未经 Contract Change 的 Domain/Bounded Context/Service/Public Contract 变更
acceptance:
- ACCEPTANCE_NOT_FROZEN
verification: []
evidence: []
```

### EXE-BR-002

```yaml
id: EXE-BR-002
status: READY
implementationReadiness: PLANNED
priority: PENDING_DECISION
type: IMPLEMENTATION
owner:
  domain: execution
  boundedContext: execution
  moduleRef: execution-browser-extension
sourceRefs:
- EXECUTION-EXECUTION-BROWSER-EXTENSION-TECH-DESIGN
- EXECUTION-DOC-02-01
- EXECUTION-DOC-02-02
qualityRefs:
- EXECUTION-DOC-05-02
dependencyState: NOT_FROZEN
dependsOn: []
goal: 实现 Extension New Task 三 Worker CREATE/partial recovery、page-level RESTORE、minimal WAKE 与真实 c-id/Conversation locator observation
scope:
  allow:
  - packages/execution-browser-extension/**
  forbid:
  - 其他 Domain 的业务 Store/Repository
  - 其他领域内部实现的 deep import
  - 任何未经 Contract Change 的 Domain/Bounded Context/Service/Public Contract 变更
acceptance:
- ACCEPTANCE_NOT_FROZEN
verification: []
evidence: []
```

### EXE-BR-003

```yaml
id: EXE-BR-003
status: READY
implementationReadiness: PLANNED
priority: PENDING_DECISION
type: IMPLEMENTATION
owner:
  domain: execution
  boundedContext: execution
  moduleRef: execution-browser-extension
sourceRefs:
- EXECUTION-EXECUTION-BROWSER-EXTENSION-TECH-DESIGN
- EXECUTION-DOC-02-01
- EXECUTION-DOC-02-02
qualityRefs:
- EXECUTION-DOC-05-02
dependencyState: NOT_FROZEN
dependsOn: []
goal: 实现 Task Observer deterministic progression + 单 Task REASON diagnostic exception；page IDLE/BUSY/BLOCKED/UNKNOWN 只作 Carrier runtime view
scope:
  allow:
  - packages/execution-browser-extension/**
  forbid:
  - 其他 Domain 的业务 Store/Repository
  - 其他领域内部实现的 deep import
  - 任何未经 Contract Change 的 Domain/Bounded Context/Service/Public Contract 变更
acceptance:
- ACCEPTANCE_NOT_FROZEN
verification: []
evidence: []
```

### EXE-BR-004

```yaml
id: EXE-BR-004
status: READY
implementationReadiness: PLANNED
priority: PENDING_DECISION
type: IMPLEMENTATION
owner:
  domain: execution
  boundedContext: execution
  moduleRef: execution-browser-extension
sourceRefs:
- EXECUTION-EXECUTION-BROWSER-EXTENSION-TECH-DESIGN
- EXECUTION-DOC-02-01
- EXECUTION-DOC-02-02
qualityRefs:
- EXECUTION-DOC-05-02
dependencyState: NOT_FROZEN
dependsOn: []
goal: 实现 Always-Allow 主路径下的 permission fallback、screenshot→Vision recovery、Approval/Alert UI 与 Side Panel current-reality display
scope:
  allow:
  - packages/execution-browser-extension/**
  forbid:
  - 其他 Domain 的业务 Store/Repository
  - 其他领域内部实现的 deep import
  - 任何未经 Contract Change 的 Domain/Bounded Context/Service/Public Contract 变更
acceptance:
- ACCEPTANCE_NOT_FROZEN
verification: []
evidence: []
```

### EXE-BR-005

```yaml
id: EXE-BR-005
status: READY
implementationReadiness: PLANNED
priority: PENDING_DECISION
type: IMPLEMENTATION
owner:
  domain: execution
  boundedContext: execution
  moduleRef: execution-browser-extension
sourceRefs:
- EXECUTION-EXECUTION-BROWSER-EXTENSION-TECH-DESIGN
- EXECUTION-DOC-02-01
- EXECUTION-DOC-02-02
qualityRefs:
- EXECUTION-DOC-05-02
dependencyState: NOT_FROZEN
dependsOn: []
goal: 实现 Worker Turn 多 Action无 per-action WAKE、Browser write安全串行与 physical Collaboration delivery
scope:
  allow:
  - packages/execution-browser-extension/**
  forbid:
  - 其他 Domain 的业务 Store/Repository
  - 其他领域内部实现的 deep import
  - 任何未经 Contract Change 的 Domain/Bounded Context/Service/Public Contract 变更
acceptance:
- ACCEPTANCE_NOT_FROZEN
verification: []
evidence: []
```

### EXE-BR-006

```yaml
id: EXE-BR-006
status: READY
implementationReadiness: PLANNED
priority: PENDING_DECISION
type: IMPLEMENTATION
owner:
  domain: execution
  boundedContext: execution
  moduleRef: execution-browser-extension
sourceRefs:
- EXECUTION-EXECUTION-BROWSER-EXTENSION-TECH-DESIGN
- EXECUTION-DOC-02-01
- EXECUTION-DOC-02-02
qualityRefs:
- EXECUTION-DOC-05-02
dependencyState: NOT_FROZEN
dependsOn: []
goal: 实现 reload/reconnect Recovery Scan、UNKNOWN no-blind-replay 与 effect_started reality reconciliation
scope:
  allow:
  - packages/execution-browser-extension/**
  forbid:
  - 其他 Domain 的业务 Store/Repository
  - 其他领域内部实现的 deep import
  - 任何未经 Contract Change 的 Domain/Bounded Context/Service/Public Contract 变更
acceptance:
- ACCEPTANCE_NOT_FROZEN
verification: []
evidence: []
```

### EXE-BR-007

```yaml
id: EXE-BR-007
status: READY
implementationReadiness: PLANNED
priority: PENDING_DECISION
type: VALIDATION
owner:
  domain: execution
  boundedContext: execution
  moduleRef: execution-browser-extension
sourceRefs:
- EXECUTION-EXECUTION-BROWSER-EXTENSION-TECH-DESIGN
- EXECUTION-DOC-02-01
- EXECUTION-DOC-02-02
qualityRefs:
- EXECUTION-DOC-05-02
dependencyState: NOT_FROZEN
dependsOn: []
goal: 完成真实 Chrome + ChatGPT J1-J6 Carrier E2E、Always Allow/Multi-action/File Bridge、fault injection 与 no-blind-retry tests
scope:
  allow:
  - packages/execution-browser-extension/**
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


### EXE-BR-008

```yaml
id: EXE-BR-008
status: READY
implementationReadiness: PLANNED
priority: PENDING_DECISION
type: IMPLEMENTATION
owner:
  domain: execution
  boundedContext: execution
  moduleRef: execution-browser-extension
sourceRefs:
- EXECUTION-EXECUTION-BROWSER-EXTENSION-TECH-DESIGN
- EXECUTION-DOC-03-04
- MODEL-DOC-03-08
goal: 实现最低优先级 System Observer 的 8 类 bounded views、分批 REASON、carry-forward、drill-down 与 global synthesis；assessment 只派生不改 Owner facts
scope:
  allow:
  - packages/execution-browser-extension/**
  forbid:
  - 其他 Domain 的业务 Store/Repository
  - System Observer 直接修改 Task/Execution/Agent/Deployment facts
acceptance:
- ACCEPTANCE_NOT_FROZEN
verification: []
evidence: []
```

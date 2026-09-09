---
docId: EXECUTION-TODO-EXECUTION-LOCAL
title: '`execution-local` TODO'
docType: todo
authority: operational
lifecycle: active
domain: execution
boundedContext: execution
moduleRef: execution-local
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- EXECUTION-EXECUTION-LOCAL-TECH-DESIGN
- EXECUTION-DOC-02-01
---
# `execution-local` TODO

> 本文件是该 Module 的当前实施 backlog。`Status: READY` 保留原任务事实，表示任务已进入当前 backlog；`implementationReadiness: PLANNED` 表示**尚未冻结自动施工顺序**。Priority、dependsOn、逐任务 acceptance/verification 不允许由文档整理工具推断；没有可直接追溯的冻结依据时，分别保持 `PENDING_DECISION`、`NOT_FROZEN`、`ACCEPTANCE_NOT_FROZEN` / `verification: []`。

## Implementation Tasks
### EXE-LOCAL-001

```yaml
id: EXE-LOCAL-001
status: READY
implementationReadiness: PLANNED
priority: PENDING_DECISION
type: IMPLEMENTATION
owner:
  domain: execution
  boundedContext: execution
  moduleRef: execution-local
sourceRefs:
- EXECUTION-EXECUTION-LOCAL-TECH-DESIGN
- EXECUTION-DOC-02-01
qualityRefs:
- EXECUTION-DOC-05-02
dependencyState: NOT_FROZEN
dependsOn: []
goal: 实现 projectRoot canonical boundary 与 .proflow protected rules
scope:
  allow:
  - packages/execution-local/**
  forbid:
  - 其他 Domain 的业务 Store/Repository
  - 其他领域内部实现的 deep import
  - 任何未经 Contract Change 的 Domain/Bounded Context/Service/Public Contract 变更
acceptance:
- ACCEPTANCE_NOT_FROZEN
verification: []
evidence: []
```

### EXE-LOCAL-002

```yaml
id: EXE-LOCAL-002
status: READY
implementationReadiness: PLANNED
priority: PENDING_DECISION
type: IMPLEMENTATION
owner:
  domain: execution
  boundedContext: execution
  moduleRef: execution-local
sourceRefs:
- EXECUTION-EXECUTION-LOCAL-TECH-DESIGN
- EXECUTION-DOC-02-01
qualityRefs:
- EXECUTION-DOC-05-02
dependencyState: NOT_FROZEN
dependsOn: []
goal: 实现 Local Dev read/list/search/mutate/run/process 六类 Direct Tool adapter，与内部 Execution adapter 分离并只复用纯 primitives
scope:
  allow:
  - packages/execution-local/**
  forbid:
  - 其他 Domain 的业务 Store/Repository
  - 其他领域内部实现的 deep import
  - 任何未经 Contract Change 的 Domain/Bounded Context/Service/Public Contract 变更
acceptance:
- ACCEPTANCE_NOT_FROZEN
verification: []
evidence: []
```

### EXE-LOCAL-003

```yaml
id: EXE-LOCAL-003
status: READY
implementationReadiness: PLANNED
priority: PENDING_DECISION
type: IMPLEMENTATION
owner:
  domain: execution
  boundedContext: execution
  moduleRef: execution-local
sourceRefs:
- EXECUTION-EXECUTION-LOCAL-TECH-DESIGN
- EXECUTION-DOC-02-01
qualityRefs:
- EXECUTION-DOC-05-02
dependencyState: NOT_FROZEN
dependsOn: []
goal: 实现 Local Dev process list/ports/status/start/read/input/stop、tool-native handle 与 bounded stdout/stderr；不复用 Execution lifecycle
scope:
  allow:
  - packages/execution-local/**
  forbid:
  - 其他 Domain 的业务 Store/Repository
  - 其他领域内部实现的 deep import
  - 任何未经 Contract Change 的 Domain/Bounded Context/Service/Public Contract 变更
acceptance:
- ACCEPTANCE_NOT_FROZEN
verification: []
evidence: []
```

### EXE-LOCAL-004

```yaml
id: EXE-LOCAL-004
status: READY
implementationReadiness: PLANNED
priority: PENDING_DECISION
type: IMPLEMENTATION
owner:
  domain: execution
  boundedContext: execution
  moduleRef: execution-local
sourceRefs:
- EXECUTION-EXECUTION-LOCAL-TECH-DESIGN
- EXECUTION-DOC-02-01
qualityRefs:
- EXECUTION-DOC-05-02
dependencyState: NOT_FROZEN
dependsOn: []
goal: 接入 Repomix pack/grep/read 的真实 npm/library 或受控 CLI，保留独立 native handle 与 workspace safety
scope:
  allow:
  - packages/execution-local/**
  forbid:
  - 其他 Domain 的业务 Store/Repository
  - 其他领域内部实现的 deep import
  - 任何未经 Contract Change 的 Domain/Bounded Context/Service/Public Contract 变更
acceptance:
- ACCEPTANCE_NOT_FROZEN
verification: []
evidence: []
```

### EXE-LOCAL-005

```yaml
id: EXE-LOCAL-005
status: READY
implementationReadiness: PLANNED
priority: PENDING_DECISION
type: IMPLEMENTATION
owner:
  domain: execution
  boundedContext: execution
  moduleRef: execution-local
sourceRefs:
- EXECUTION-EXECUTION-LOCAL-TECH-DESIGN
- EXECUTION-DOC-02-01
qualityRefs:
- EXECUTION-DOC-05-02
dependencyState: NOT_FROZEN
dependsOn: []
goal: 接入 CodeGraph explore 真实 npm/library 或受控 CLI，不使用 MCP transport，不把 Model/Execution readiness 变成 Direct Tool 前置
scope:
  allow:
  - packages/execution-local/**
  forbid:
  - 其他 Domain 的业务 Store/Repository
  - 其他领域内部实现的 deep import
  - 任何未经 Contract Change 的 Domain/Bounded Context/Service/Public Contract 变更
acceptance:
- ACCEPTANCE_NOT_FROZEN
verification: []
evidence: []
```

### EXE-LOCAL-006

```yaml
id: EXE-LOCAL-006
status: READY
implementationReadiness: PLANNED
priority: PENDING_DECISION
type: VALIDATION
owner:
  domain: execution
  boundedContext: execution
  moduleRef: execution-local
sourceRefs:
- EXECUTION-EXECUTION-LOCAL-TECH-DESIGN
- EXECUTION-DOC-02-01
qualityRefs:
- EXECUTION-DOC-05-02
dependencyState: NOT_FROZEN
dependsOn: []
goal: 完成 symlink/path traversal/secret redaction/security tests
scope:
  allow:
  - packages/execution-local/**
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

### EXE-LOCAL-007

```yaml
id: EXE-LOCAL-007
status: READY
implementationReadiness: PLANNED
priority: PENDING_DECISION
type: IMPLEMENTATION
owner:
  domain: execution
  boundedContext: execution
  moduleRef: execution-local
sourceRefs:
- EXECUTION-EXECUTION-LOCAL-TECH-DESIGN
- EXECUTION-DOC-02-01
- EXECUTION-DOC-03-01
qualityRefs:
- EXECUTION-DOC-05-02
dependencyState: NOT_FROZEN
dependsOn: []
goal: 实现 bounded File Bridge materialization、Context Pack Artifact 与 Patch proposal validate/apply mechanics；保持 scope/secret/size/hash/UNKNOWN 边界
scope:
  allow:
  - packages/execution-local/**
  forbid:
  - ContextPack/Patch/File 独立业务 Service/Store
  - 绕过 Execution Policy/Approval 直接 apply GPT output
  - 其他 Domain 的业务 Store/Repository
acceptance:
- ACCEPTANCE_NOT_FROZEN
verification: []
evidence: []
```


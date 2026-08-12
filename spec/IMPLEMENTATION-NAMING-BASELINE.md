# ProFlow Implementation Naming Baseline

这是 **实施命名映射**，不是对 FINAL FROZEN 文档的改写。

## 当前实施命名

```text
Product:              ProFlow
Repository:           proflow
Workspace instance:   .proflow/
npm account/scope:    @tomflow/*
Package rule:         @tomflow/proflow-<package>
```

示例：

```text
@tomflow/proflow-module-contract
@tomflow/proflow-task-orchestration
@tomflow/proflow-model-runtime
@tomflow/proflow-execution-runtime
@tomflow/proflow-agent-runtime
```

## Frozen 文档中的旧命名

Frozen 文档中若存在：

```text
ai-agent-platform
@ai-agent-platform/*
.ai-agent-platform/
```

不得直接修改 Frozen 文件。

实现层按以下规则机械映射：

```text
产品/仓库语义              → ProFlow / proflow
发布包 @ai-agent-platform/X → @tomflow/proflow-X
Workspace 实例目录          → .proflow/
```

映射只改变实施/发布命名，不改变：

- Domain
- Bounded Context
- Module ownership
- Contract
- State machine
- Provides / Requires
- Runtime topology
- Test obligation

如遇到无法机械映射的标识，STOP，单独做 Naming Decision；禁止猜测。

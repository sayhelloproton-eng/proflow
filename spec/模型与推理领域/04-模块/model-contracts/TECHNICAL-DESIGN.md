---
docId: MODEL-REASONING-TECH-MODEL-CONTRACTS
title: '`model-contracts` Technical Design Index'
docType: module-design-index
authority: normative
lifecycle: active
domain: model-reasoning
boundedContext: model-reasoning
moduleRef: model-contracts
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- MODEL-REASONING-TECH-MODEL-CONTRACTS
- MODEL-DOC-02-01
- MODEL-DOC-02-02
---

# `model-contracts` Technical Design Index

## Responsibility

薄 Public Contract Module，定义 infer/getRuntimeStatus 及 typed Reasoning/health DTO，不承担 provider/runtime。

## Existing detailed sources

- [01-Public-Contract与TypeScript类型规范.md](../../02-契约/01-Public-Contract与TypeScript类型规范.md)
- [00-总体架构-包-服务-运行拓扑.md](../00-总体架构-包-服务-运行拓扑.md)

## Boundary Rule

本文件只定义该 Module 的工程落点，不复制 Domain / Bounded Context 的 canonical facts。若实现需要引入当前 normative Contract 未定义的新算法语义、状态、持久化事实或跨域 Contract，必须先完成对应设计与 Contract Change；不得由 TODO/Codex 自行补全。
## Observer-specific contract constraints

- 不新增 `assessSystem()` / `judgeTask()` API；复用 `infer()`。
- `InferenceTraceContext` 可携带 `assessmentRef`；System Assessment 使用 `priority=background`。
- context budget 超限必须显式 `CONTEXT_TOO_LARGE`/等价 typed error，由 caller 拆 batch；contract/runtime 不偷偷截断或“自动总结”。
- Model output 是 judgment/assessment，不是 Task transition、Execution Approval 或 Effect authorization。


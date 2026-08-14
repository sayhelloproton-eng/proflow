---
docId: MODEL-REASONING-MODULE-REGISTRY
title: 模型与推理领域｜Module Registry
docType: module-registry
authority: normative
lifecycle: active
domain: model-reasoning
canonicalFor:
- model-reasoning.module-registry
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs: []
---

# 模型与推理领域｜Module Registry

> 这里建立 **Bounded Context → Module → Package / Service / Process / Deployment Unit** 的工程映射。Module 是治理/实现单元，不自动等于 Service 或 Process。

| moduleRef | package | kind | service | process/deployment | technical docs |
|---|---|---|---|---|---|
| `model-contracts` | `@tomflow/proflow-model-contracts` | library | — | — | [model-contracts](./model-contracts/README.md) |
| `model-runtime` | `@tomflow/proflow-model-runtime` | service | model-runtime | model-runtime-process | [model-runtime](./model-runtime/README.md) |

## 规则

- 正式跨域依赖只指向 Module 的 Public Provides/Contract。
- Library 不伪造 start/stop。
- Service 只有真实长期 runtime 时才存在。
- Deployment Unit 的真实生命周期由 Deployment Domain 治理。
- Module 文档通过链接引用领域级 canonical Contract / Flow / Persistence，不为“模板完整”复制第二套正式事实。

## 2026-08-15 Observer inference alignment

`model-contracts` 继续只定义 `infer()/getRuntimeStatus()` 与 typed Reasoning contracts；Task Diagnostic/System Assessment 通过 versioned `specRef` 复用 `infer()`。`model-runtime` 提供 FAST/REASON/Vision typed inference，不拥有 Task/System Observer Store、batch scheduler 或业务 authority；System Observer 的 batching/carry-forward/drill-down/global synthesis 在 caller/application 侧组织。


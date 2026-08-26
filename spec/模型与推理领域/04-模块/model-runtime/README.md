---
docId: MODEL-REASONING-MODULE-MODEL-RUNTIME
title: '`model-runtime` Module'
docType: module-index
authority: normative
lifecycle: active
domain: model-reasoning
boundedContext: model-reasoning
moduleRef: model-runtime
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- MODEL-MODEL-RUNTIME-TECH-DESIGN
- MODEL-DOC-02-01
- MODEL-DOC-02-02
---

# `model-runtime` Module

## Identity

```text
Domain: model-reasoning
Bounded Context: model-reasoning
moduleRef: model-runtime
package: @tomflow/proflow-model-runtime
kind: service
service: model-runtime
process/deployment: model-runtime-process
```

## Purpose

本 README 是该 Module 的导航入口；正式业务与工程事实由本 Module 技术设计及所属领域 Contract/Flow 共同定义，不维护第二套重复事实。

## Canonical technical docs

- [TECHNICAL-DESIGN.md](TECHNICAL-DESIGN.md)
- [01-Reasoning-Spec与Small-Model-First规范.md](../../03-流程与数据/01-Reasoning-Spec与Small-Model-First规范.md)
- [03-路由-单Lane-队列-超时-取消.md](../../03-流程与数据/03-路由-单Lane-队列-超时-取消.md)
- [06-Runtime-Health与推理可观测性.md](../../03-流程与数据/06-Runtime-Health与推理可观测性.md)

## Public Contract / Dependencies

- 使用本领域 `02-契约/` 的 Public Contract。
- 跨域只通过 Public Contract / logical Provides-Requires。
- 禁止读取其他领域 DB、Repository、内部 Adapter 或 deep import。

## Runtime / Lifecycle

- `service` 的真实 lifecycle 由 Module 自身声明并由 Deployment Domain 治理。
- Library 不伪造 start/stop。
- Service/Process 的启动、关闭、health、recovery 以对应 TECHNICAL-DESIGN 与 Deployment requirements 为准。

## Testing

见本领域 `05-质量与部署/` 和本 Module `TODO.md` 的 acceptance/verification。

## Current implementation disposition

- `47bc8dc` 已集成 Provider inventory 消费、能力证据优先的 FAST/REASON 映射、inventory drift/runtime freshness、歧义 fail-closed 与真实本地进程 `/ready`。
- Provider 17/17、Runtime 61/61；Runtime 全包连续三次通过是确定性代码门，不是 Real External PASS。
- 正常 setup 不要求模型 ID；只有多个能力合格候选仍无法消歧时，才允许在该集合内选择。
- 完整产品仍被 Deployment-owned endpoint resolver 缺失阻塞；本 Module 不实现 Bonjour/DNS-SD 或设备/产品 discovery。
- Platform 的 `start/stop` 不支持 `--module`；正常生命周期只能由完整 `platform start` / `platform stop` 统一编排。

---
docId: PLATFORM-HOST-TODO
title: '`platform-host` TODO'
docType: todo
authority: operational
lifecycle: active
domain: platform
moduleRef: platform-host
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- PLATFORM-HOST-TECH-DESIGN
- PLATFORM-HOST-COMPOSITION-ROOT
---

# `platform-host` TODO

> 目标：完成 Application Composition Root，不扩张为第六领域、Observer runtime 或业务 Scheduler。

## PH-001｜Composition Graph

- [ ] 装配 `task-orchestration` 与 `agent-runtime` 独立 package。
- [ ] 注入 Execution / Model public clients。
- [ ] 禁止 deep import 与 shared repository。

## PH-002｜Local Public Transport

- [ ] 为 Owner Command/Query 提供 typed local routing。
- [ ] 保留 actor/idempotency/version/correlation 字段，不在 host 改写业务语义。
- [ ] dependency unavailable 返回 typed transport/dependency error。

## PH-003｜Observer Consumer Support

- [ ] Extension Task Observer 可读取 Task drive projection。
- [ ] Extension System Observer 可读取 bounded public health/fact views，并调用 Model public `infer`。
- [ ] host 不实现 Observer progression、batching/carry-forward/system assessment store。
- [ ] host 不直接 WAKE Browser 或 complete/reopen/approve。

## PH-004｜Lifecycle / Health

- [ ] startup/shutdown/drain deterministic。
- [ ] process/transport/dependency health 与 Domain READY 分层。
- [ ] restart 重新读取 owner current reality，不 replay mutation。

## PH-005｜Architecture Guard

- [ ] machine gate：host 无 Task/Agent/Execution business repository。
- [ ] machine gate：无 universal scheduler/event bus/global mutable mirror。
- [ ] machine gate：Domain packages 不反向依赖 platform-host。

## Acceptance

`platform-host` 只证明 composition/transport/lifecycle；Task Journey、Task/System Observer、Browser Carrier、Execution Effect 与 Model assessment 均由各自测试计划证明。

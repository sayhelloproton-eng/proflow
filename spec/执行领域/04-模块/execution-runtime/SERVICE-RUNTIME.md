---
docId: EXECUTION-RUNTIME-SERVICE-RUNTIME
title: '`execution-runtime` Service Runtime'
docType: service-runtime
authority: normative
lifecycle: active
domain: execution
boundedContext: execution
moduleRef: execution-runtime
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- EXECUTION-EXECUTION-RUNTIME-TECH-DESIGN
- EXECUTION-DOC-02-01
- EXECUTION-DOC-02-02
---

# `execution-runtime` Service Runtime

## Process
唯一 backend durable Execution Service；不承载 GPT Local Tools。

## Startup
加载 config/store → 恢复 durable running/unknown records → 读取 `execution-browser-extension` 发布的 Browser lane endpoint/credential/readiness → 注册仍需 durable semantics 的 executor clients → 启动 internal API → health/ready。Execution Runtime 不创建/关闭 Browser Reality Bridge。

## Runtime
内部 `executeCapability`（若保留）只处理 Browser/Carrier/Approval/UNKNOWN/materialization 等 durable operation；GPT-facing Repomix/Local Dev/CodeGraph 不进入该接口。

## Concurrency
Browser writes 与 durable effect 遵守既有 serial/idempotency/recovery 规则。Local Tool lane 有自己的 queue/timeout/readiness，不与 Runtime Browser lane共享。

## Shutdown / Restart
停止新 durable effect → drain safe work → 已 started 未确认的 effect 保留 recovery state。restart 后 reality-first reconcile，不盲重放。停止/重启 Execution Runtime 不得停止 `execution-browser-extension` bridge runtime，也不得中断 Local Tool lane。

## Readiness
Execution Runtime readiness 只决定依赖它的 durable internal operation；不能被 Gateway/Host 当成 Task/Peer/Local Tools 的全局前置。

## 审计补充：按 operation 迟绑定

formal startup 不再要求 Model ready 或 Host identity ready 才发布自身 transport。需要身份/approval/model policy 的具体 operation 在 effect 前 fail-closed；deterministic Browser WAKE 不因无 Model 拒绝。browser executor 必须使用 Extension-owned bridge client，不再调用会创建 listener 的 composition factory。

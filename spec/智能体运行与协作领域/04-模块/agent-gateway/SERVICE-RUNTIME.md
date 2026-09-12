---
docId: AGENT-GATEWAY-SERVICE-RUNTIME
title: '`agent-gateway` Service Runtime'
docType: service-runtime
authority: normative
lifecycle: active
domain: agent-runtime-collaboration
boundedContext: agent-runtime-collaboration
moduleRef: agent-gateway
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- AGENT-AGENT-GATEWAY-TECH-DESIGN
- AGENT-DOC-02-01
- AGENT-DOC-02-02
---

# `agent-gateway` Service Runtime

## Process
独立 backend process，公网只暴露 Custom GPT Actions 所需入口；内部只调用公开 Domain contracts。

## Startup
加载 Role credential/config → 校验 OpenAI Action schema/transport config → 建立 downstream clients → 启动 HTTPS/public ingress → health/ready。

## Request lifecycle
Authenticate → role resolve → unknown/runtime validation → OpenAI adapter normalize → Task/Peer owner route **或** Local Tool API route → serialize bounded result/file relay → emit typed HTTP status。Local Tool request 只含 `operation + input`，不携带 Task/Node/Worker/Execution identity。

## Timeouts
Action round-trip 必须受 45s ceiling 约束。Local Tool 长进程通过 `Local Dev.process` 原生 process handle 管理，不创建 ProFlow Execution polling；File relay/fetch 有独立更短 timeout。

## Health/Readiness
process alive、public ingress、credential store 与 Host transport 分开检查；/ready 只表示入口可接收并认证请求。Tool/Browser/Model/relay 的 unavailable 按 operation 报告，不以全局 downstream 聚合状态拒绝 Task/Peer/其它 Tool。

## Recovery
Gateway restart 不重放业务 mutation。请求结果不确定时由 owner idempotency/事实查询决定后续动作；transient relay 可重新生成但不能改变 owner artifact identity。

## Worker Turn / permission behavior

The service keeps no WorkerTurn state and emits no action-completion signal that requires Browser to send “continue”. 2026-09-13 起，三个 shipped Role 的全部 Custom GPT Actions 均显式 `x-openai-isConsequential:false`，包括混合 Local Dev。Carrier metadata 不授予本机 Effect 权限；Local Dev mutation/run/process 仍由 Role policy、Browser Extension Effect Gate、provider safety、deadline 与 UNKNOWN/no-blind-replay 约束。若 ChatGPT 仍出现 unexpected permission prompt，按 Browser Carrier recovery 处理，而不是恢复成每次 Action 的预期人工确认。

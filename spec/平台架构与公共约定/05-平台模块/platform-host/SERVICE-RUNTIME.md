---
docId: PLATFORM-HOST-SERVICE-RUNTIME
title: '`platform-host` Service Runtime'
docType: service-runtime
authority: normative
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

# `platform-host` Service Runtime

## Startup

```text
load materialized config
→ construct Task/Agent owners
→ construct Browser lane / Local Tool lane clients
→ construct optional Execution/Model internal clients
→ start backend reconciliation coordinator
→ expose local API transport
```

Host READY 只证明自身 application/transport；每个 operation 再检查自身依赖。

## Runtime requests

```text
Task/Peer → owning domain
Local Tool → role admission → typed command → Extension Local Tool lane
Browser durable effect → internal Execution/Carrier path
Task progression → backend reconciliation reads owner facts → Carrier request
```

Host 不执行本机 Tool implementation。

## Reconciliation

bounded catch-up 以 durable owner facts 为准；Extension/page event 只加速。per-task single-flight，异常诊断不占 progression lock。restart 后重新扫描 bounded nonterminal candidates，不从 host cache/log恢复业务事实。

## Shutdown

停止接收新请求 → 停 reconciliation 调度 → drain 当前同步 route → 关闭 transport。不得为“清理”修改 Domain durable state。

## Health

分别报告 host transport、Task/Peer owner、Browser lane、Local Tool lane、每个 Tool、Execution internal、Model diagnostic；禁止一个 aggregate boolean 提前挡住无关 operation。

## 审计补充：冷启动与关闭

Execution/Model clients 可在无 endpoint/credential 时构造成 unavailable port，配置后按 operation 重新解析；host compose/start 不等待两者。Gateway readiness 只探测 Host ingress/auth 可用。Bridge 依赖指模块已存在且提供 contract，不把 Browser consumer/全部 Provider healthy 当成 Host 接收 Task/Peer 的条件。

shutdown 设置 closing generation，停新 catch-up/event admission，取消 queued decisions，bounded 等待已发请求后关闭本客户端；不得关闭 Extension-owned bridge。晚到 scan/diagnostic callback 检查 generation 后丢弃，不再 dispatch。

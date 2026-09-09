---
docId: PLATFORM-HOST-TECH-DESIGN
title: '`platform-host` Technical Design'
docType: module-design
authority: normative
lifecycle: active
domain: platform
moduleRef: platform-host
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- PLATFORM-HOST-COMPOSITION-ROOT
- AGENT-DOC-02-05
---

# `platform-host` Technical Design

## 1. Composition

```text
platform-host
├─ Task / Agent owner composition
├─ API route/admission for Task/Peer/Tools
├─ backend Task Observer / Reconciliation coordinator
├─ Execution internal client（Browser/Carrier/materialization only）
├─ Model diagnostic client（按需）
└─ Browser Extension command transports
   ├─ existing Browser lane
   └─ dedicated Local Tool lane
```

## 2. Responsibilities

1. composition root / DI / local API transport；
2. Task/Peer route 到正式 Owner；
3. Local Tool Action 做 Role×Tool×Operation admission、typed command 与 correlation，然后投递 **Browser Extension Local Tool lane**；
4. backend deterministic Task Observer/Reconciliation 做 bounded catch-up；不拥有 Task state；
5. operation-scoped readiness，不把 Model/旧 Execution Runtime/某个 Tool 故障升级成全局不可用；
6. 启停/health 只描述 host/application reality；Host 只消费 `execution-browser-extension` 发布的 `local-tool-bridge` endpoint/credential/readiness，不拥有 bridge lifecycle。

## 3. Local Tool forbidden boundary

Host/API 的 **GPT Local Tool route 不得 import/call 以下本机执行实现**：

```text
fs / git / child_process / shell
Repomix library
CodeGraph library
execution-local Tool implementation
```

本机工具只能：

```text
API → Extension dedicated local-tool command lane → execution-local → macOS
```

## 4. Reconciliation

Task Owner 仍是 workflow truth。host application 可组合 deterministic observer + per-task single-flight/backoff + bounded catch-up：

```text
owner event / page kick / periodic bounded catch-up
→ re-read current facts
→ deterministic next-step
→ request Carrier WAKE/RESTORE or no-op
```

System Observer reasoning 不进入 progression 临界区；Model unavailable 不阻塞 deterministic progression。

## 5. Failure isolation

- Local Tool lane DOWN：Task/Peer/Browser lane仍按依赖工作；
- Browser lane DOWN：Task/Peer API仍可工作；
- Model DOWN：deterministic Task progression仍工作；
- old Execution Runtime DOWN：Local Tools 不因此 DOWN；需要 durable Browser effect 的 operation 单独 unavailable。

## 6. Forbidden

- Host 本机工具 bypass；
- universal scheduler/event bus；
- business Repository/state mirror；
- Browser DOM/frame/tab registry；
- System assessment → direct mutation；
- Local Tool 与 Browser command 共用串行 queue/loop。

Host 加载自身配置、credential、Task/Agent Owner 正常 persistence 和日志不属于 GPT Tool bypass；禁止的是把 Tool 输入路径/argv 交给 Host 本地 fs/process，或使用内部 Execution route 代办 Direct Tool。结构检查必须追踪可达调用，不能用整个 Host 出现 node:fs 就判失败。

Reconciliation 的 cursor、公平性、版本复验、stable dedupe 与关闭 generation 以 `TASK-DOC-03-05` §8 为准；不得直接 import Extension 的 Task Observer implementation。可把纯 deterministic decision 迁至 Host application 内部，以 Task public port 为输入，Browser public port 为输出。

F9 已按用户裁决关闭：trusted local command 继承 OS 用户权限，显式可识别的 Workspace 越界由 Extension Gate 提示用户后执行，无需越界批准；Host 不得转发旧 Execution 绕过 Gate。

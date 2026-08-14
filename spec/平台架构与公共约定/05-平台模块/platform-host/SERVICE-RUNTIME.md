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
→ construct Task/Agent packages
→ construct Execution/Model public clients
→ validate required dependency transport availability
→ expose local transport
→ report host READY only for host-owned transport/composition readiness
```

`host READY` 不等于 Task/Execution/Model/Deployment/Carrier 各自 READY。

## Runtime Requests

host 可承载：

```text
Owner Command/Query routing
Task drive projection transport
Agent/Collaboration query transport
Execution/Model client transport
light health projection
```

不得在 transport 层合并为新的 business transaction。

## Extension / Observer

Extension 是独立 runtime。Task Observer/System Observer 可以经 host local transport读取 owner facts或调用 Model，但 Observer loop/priority/carry-forward 不由 host 持久化。

## Shutdown

停止接收新本地请求 → drain 当前同步调用 → 关闭 host-owned transport → 释放资源。不得修改 Domain durable state 以“强行清理”。

## Health

区分：

```text
process alive
host transport healthy
dependency reachable
owner/domain readiness
platform/system assessment
```

最后两项不能被 host 自己推断为业务事实；System Observer 只把 bounded health projection作为评估输入。

## Recovery

进程重启后重新构建 graph，并查询 Owner current reality；不从 host cache/log恢复业务事实，不自动重放 Effect/Task command。

---
docId: AGENT-DOC-02-04
title: 智能体运行与协作领域｜API / 依赖 / 模块快速清单
docType: dependency-index
authority: normative
lifecycle: active
domain: agent-runtime-collaboration
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs: []
---

# 智能体运行与协作领域｜API、依赖与 Module 快速清单

## Domain Owner

```text
Agent Package / generic Role definition
roleRef registration / role credential
Worker identity validation
Collaboration Message Center
Agent Gateway / Custom GPT Actions protocol
```

不拥有 Task workflow、Browser implementation、真实 Effect、Model runtime、Deployment lifecycle。

## v1 最小业务概念

```text
AgentPackageRef / packageName
RoleRef
WorkerRef
RegisteredRole
RoleCredential
CollaborationThread
CollaborationMessage
DeliveryState / ReceiptRef
```

不建立 Agent/Session/AgentRun/WorkerTurn entity。

## 固定三个泛化 Role

```text
Product
Controller / Dev
Test / Ops
```

专业化 Knowledge 不进入 v1；不做动态 Role discovery / capability matching 主链。

## Identity

```text
agentPackageRef/packageName = logical role type
roleRef = deployed Custom GPT g-id
credential = GPT→Gateway secret
workerRef = Task-scoped Conversation c-id
conversationLocator = Browser restore locator
```

Browser不持有Role credential；Task/Agent都不把tab/frame当业务identity。

## Agent Runtime Public API

### Role Registry（management / Deployment / Carrier lookup）

```text
listRegisteredRoles(...)
getRegisteredRole(...)
```

**不作为 Product GPT New Task 主链。**

### Collaboration

```text
askPeer(...)
replyPeer(...)
```

pending/delivery internal capability保持Agent owner语义，不直接变成GPT业务Action。

## New Task / Worker dependency

```text
Extension New Task
→ Task.createTask(PENDING)
→ fixed packageName→roleRef lookup
→ Browser Carrier CREATE/observe Product + Dev + Test new Conversations
→ Agent validate Worker identity
→ Task.bindTaskWorker × 3
→ Product bound 后即可 Requirement discussion/write
→ Dev/Test WORKER_BIND only, remain IDLE
→ Requirement + 3 bindings + prerequisites
→ Task READY
→ human confirmation channel
→ startTask
```

Partial success只补缺失Worker；不得因为一个失败重建已成功Conversation。

Product GPT不调用`createTask/listRegisteredRoles/getRegisteredRole`主链。

## Requires｜Task

```text
createTask（Extension/platform-host application）
getTask / getNodeContext / getTaskDriveProjection（按consumer）
bindTaskWorker
startTask
startNode / completeNode / waitNode / reopenNode
TaskDocument reads/writes
participant/status/version validation
```

Agent绝不读Task SQLite。

## Requires｜Execution

```text
Browser CREATE / RESTORE / WAKE / physical delivery
Local typed capabilities
File fetch/materialization
Artifact/Result/Evidence
UNKNOWN/reality reconciliation
```

Agent不直接执行shell/git/browser effect。

## Requires｜Model

Custom GPT cognition不等于Model Domain。平台内部仅：

```text
Task diagnostic REASON（exceptional）
System assessment REASON（lowest priority）
Vision page/screenshot fallback
```

## Requires｜Deployment

```text
module config/materialization
public-ingress External Resource
Custom GPT carrier readiness
Action Auth / native capability requirements
verify/doctor/ACTION_REQUIRED_WEB
```

## Gateway

```text
Custom GPT
→ HTTPS 443 public ingress
→ agent-gateway
→ Agent/Task/Execution public contracts
```

约束：45s ceiling、request/response `<100k chars`、真实429/5xx、无arbitrary custom headers、File Bridge、显式`x-openai-isConsequential`。

Gateway薄：auth / schema / protocol normalize / routing / serializer；不拥有文件、Task、Execution、Tool Router AI。

## Worker Turn / GPT Native

一次WAKE可形成一个语义Worker Turn；同一Conversation内可连续`0..N` Actions，不在每Action之间Browser wake。

优先复用：

```text
Conversation context/file search
File Bridge
Code Interpreter
Web Search
```

大型动态上下文走Task/Artifact→File Bridge，不走Browser DOM注入。

## Browser

Browser Extension属于Execution。Agent只依赖稳定logical capabilities/results，不依赖tab/window/content/frame internal id。无Frame Registry/iframe workspace/persistent tab business identity。

## Authentication

```text
Custom GPT → Gateway = one Role one random Bearer/API key
Browser Extension → Execution Runtime = local-platform-token
```

## Collaboration durable boundary

Message Center保存logical thread/message/participants/reply/delivery state/idempotency；不复制full transcript、Task docs、Execution logs/evidence或Worker完整上下文。

## Approval / Permission

四分：

```text
Task start confirmation channel → startTask, no Task approval fact
Execution safety Approval → Execution owner
Deployment ACTION_REQUIRED(_WEB) → human action + re-observe
ChatGPT Action permission → Always Allow / carrier recovery
```

Routine Action `consequential:false`不能绕过Execution effect policy。

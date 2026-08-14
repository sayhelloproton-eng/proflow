---
docId: AGENT-DOC-02-03
title: 智能体运行与协作领域｜v1 角色 Action 静态权限矩阵
docType: policy-contract
authority: normative
lifecycle: active
domain: agent-runtime-collaboration
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- AGENT-DOC-03-07
- PLATFORM-DOC-01-04
---

# 智能体运行与协作领域｜v1 角色 Action 静态权限矩阵

> 每个 Agent Package 的 OpenAPI 是静态、版本化、角色最小化的 Carrier contract。2026-08-14 起，Product Task creation/Role discovery 移出 GPT main path；routine platform query/control/intent operation 不再依赖 OpenAI 每次 permission prompt，真实 Effect 风险仍由 Execution Policy/Approval 独立判断。

## 1. 全局原则

1. 角色只看到职责需要的 Actions。
2. GPT-facing operation 围绕业务目的，不把所有底层 primitive 平铺成高频一等工具。
3. Gateway runtime validation + authenticated Role + Owner state/version/policy 才是最终安全边界。
4. 所有真实 Effect 最终进入 Execution。
5. 每个 operation 显式 `x-openai-isConsequential`。
6. 对“记录 intent/request、真正 Effect 由 Execution 异步执行”的 platform Action，默认 `false`；这不等于 Effect 自动获批。
7. 一个 Worker Turn 内可连续调用 0..N Actions；不设计 Action-level Browser scheduler。

---

## 2. Product

### Task

```text
getTask
putTaskDocument
getTaskDocument
```

Product 在 Extension 已创建的 PENDING Task / Product Worker Conversation 内完成需求沟通，并将 `REQUIREMENT` 写入 Task。

**Product GPT main path 不暴露：**

```text
createTask
listRegisteredRoles
getRegisteredRole
```

这些分别由 Extension/platform-host 与管理/Carrier lookup 承担。

### Collaboration

```text
askPeer
replyPeer
```

仅在 Task 建立并存在正式 binding 后使用。

### Execution

Product 默认不暴露 repo mutation/shell/git 等工程 Effect。必要文件处理优先使用 Conversation/File Bridge/Code Interpreter；真正本机 Effect仍走受控 Execution。

---

## 3. Controller / Dev

### Task

```text
getTask
getNodeContext
startNode
completeNode
waitNode
failNode
reopenNode
getTaskDocument
putTaskDocument
```

`startNode` 只在当前 Worker 已收到 READY/REOPEN wake 后调用；调用方不能指定任意 workerRef。

### Collaboration

```text
askPeer
replyPeer
```

### Execution

GPT-facing 优先暴露一个清晰的 `executeCapability/requestExecution` 型业务意图入口 + `getExecution/readExecutionOutput`，底层 typed capability 由 Execution canonical registry 承担。

Context Pack / patch 推荐路径：

```text
Execution bounded Context Pack
→ File Bridge
→ Code Interpreter
→ patch/report artifact
→ File Bridge
→ Execution validate/apply/test
```

底层 read/write/git/process/network primitives 可存在于 Execution，但不要求全部平铺进 GPT OpenAPI。

---

## 4. Test / Ops

### Task

```text
getTask
getNodeContext
startNode
completeNode
waitNode
failNode
getTaskDocument
putTaskDocument
```

如 Frozen workflow 明确允许 Test/Ops 触发 `reopenNode`，才暴露具体 operation；不得暴露泛化 setStatus。

### Collaboration

```text
askPeer
replyPeer
```

### Execution

```text
request/execute test/build/lint/typecheck/health/log/browser-observe capability
getExecution
readExecutionOutput
```

高风险 Effect 仍受 Execution Policy/Approval。

---

## 5. Browser 专用接口不进入 GPT OpenAPI

```text
create/open/restore conversation
observe c-id/url
tab focus
content-script heartbeat
DOM input/submit
screenshot
recovery scan
physical collaboration delivery
```

这些属于 Execution Browser Carrier。

---

## 6. Role 管理命令不进入 GPT OpenAPI

```text
role register/list/show/delete/key rotate
custom-gpt materialize/setup
```

这些属于本地管理/Deployment/Carrier readiness。

---

## 7. OpenAI transport

### Consequential

- read/query/control/intent that **does not itself perform the real Effect** → `false`；
- 如果某 GPT-facing operation 本身直接造成真实不可逆/外部 Effect，才可按真实语义标 `true`；
- 无论 true/false，Execution Policy/Approval 不被替代。

v1 主路径目标是：routine Actions 经用户初次 `Always Allow` 后不再成为每次业务推进阻塞点；unexpected prompt 仅作为 Carrier recovery。

### File Bridge

- input：`openaiFileIdRefs`；
- output：`openaiFileResponse`；
- Gateway 只做 transport normalization/relay；
- Artifact/TaskDocument ownership 不变。

### Custom Header

不要求任意 custom headers；identity/version/idempotency/correlation 走 typed body/path/query。

---

## 8. Contract tests

每个 Role Package 至少验证：

- OpenAPI parse/operationId unique；
- 每 operation 显式 consequential；
- Product 不出现 createTask/Role-discovery mainline operations；
- Controller/Test `executeCapability` 等 request-intent operation 不把 OpenAI confirmation 当 Execution Approval；
- 不要求 arbitrary custom headers；
- File Bridge schema/transport bounds；
- Gateway → canonical Owner contract mapping；
- 一个 Worker Turn 多 Action 不要求 Browser 每 Action WAKE；
- real Custom GPT Preview/E2E 最终验证 Always Allow/Multi-action/File Bridge/CI/Web Search。

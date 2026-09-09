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
2. 模型侧只保留 `Task / Node / Document / Peer / Tools` 五类心智；不得再暴露 Capability/Execution lifecycle。
3. Direct Tools 固定为 `repomix / localDev / codeGraph` 三个 Action namespace，通过 `operation` 选择精确 operation；不建立动态 Tool discovery。
4. Task/Peer Actions 由 Owner 做业务校验；本地 Tools 由 Gateway Role auth + `Role × Tool × Operation` policy + server-bound Workspace + Browser Extension Effect Gate + `execution-local` runtime validation 防守。
5. Direct Tool request 不允许 Task/Node/Worker/Execution identity 字段。
6. 每个 operation 显式 `x-openai-isConsequential`，按该 Action 自身真实副作用判断；不再以“只是提交 Execution intent”为理由统一设 `false`。
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

### Tools

Product 可见 `repomix/localDev/codeGraph`，但默认只开放只读调查 operation：仓库概览、文件读取/搜索、结构关系。Git status/diff 属 run，默认不向 Product 开放；Local Dev mutation/command 默认拒绝，除非角色配置显式授权。Product 不接触 Execution lifecycle。

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

### Tools

Dev 直接使用：

```text
repomix   → pack / grep / read
localDev  → read/list/search/mutate/run/process（按角色 policy；Git/test 属 run）
codeGraph → explore 调用链、依赖、ownership、impact
```

模型只提交 `operation + input` 并拿 Provider 结果；不得提交 Task/Node/Worker/Execution identity，不再出现 `executeCapability/getExecution/readExecutionOutput`。Repomix/Local Dev/CodeGraph 的原生 handle 可用于同工具后续操作，但不映射成 ExecutionRef。

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

### Tools

Test/Ops 直接使用 `repomix/localDev/codeGraph`。默认允许只读、测试、构建、lint、typecheck、health/log 调查；对 mutation/发布/高风险命令按 Role policy 最小开放。Browser 专用操作仍不进入 GPT Tool Action，继续由 Carrier/Execution 内部机制处理。

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

- consequential 是 OpenAPI HTTP Operation Object 的静态字段，不能按 body.operation/oneOf 分支动态设置；
- 固定三个 POST Action 的 v1 选择：Repomix/CodeGraph 仅只读查询为 `false`；混合读写的 Local Dev 整个 Action 为 `true`（含 read）；
- Product schema 若裁成严格只读 Local Dev 子集，可为 `false`；该 Role 的 Gateway/Host ACL 必须同时拒绝全部 mutation/run/process control；默认不允许 Git 任意 argv 以“只读”绕过此限制；
- Browser/Carrier 内部 Approval 与 ChatGPT Action permission 是不同层，互不替代。

v1 主路径目标是：被声明为 nonconsequential 的 read/query HTTP Actions（不含 Dev/Test 混合 Local Dev）经用户初次 `Always Allow` 后不再成为每次业务推进阻塞点；unexpected prompt 仅作为 Carrier recovery。

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
- 三个旧 GPT-facing Execution operationId = 0；
- `repomix/localDev/codeGraph` schema 使用精确 operation discriminator，不退化为任意 object；
- Direct Tool body 不出现 Task/Node/Worker/Execution identity；
- 不要求 arbitrary custom headers；
- File Bridge schema/transport bounds；
- Gateway → Task/Peer owner 或 `ProFlow API → Browser Extension → execution-local Tool` 本地工具链映射；
- 一个 Worker Turn 多 Action 不要求 Browser 每 Action WAKE；
- real Custom GPT Preview/E2E 最终验证新 Tool schema adoption、Always Allow/Multi-action/File Bridge/CI/Web Search。

## 9. 三个 Action 的明确代价与授权粒度

固定三个 Action 时，Dev/Test 的 Local Dev read 也会提示确认且没有 Always Allow；这是保留三个 endpoint 的 v1 产品代价，不能以自动点击消除。若未来要求 read 的 Always Allow，必须另行冻结 Local Dev 只读/写入 HTTP operation 分拆，不能在 body.oneOf 内伪造 consequential。

Role policy 的匹配键为 Tool + operation + nested action + 参数约束；`process.list/ports/status/read` 与 `process.start/input/stop` 分开授权。Dev/Test 的 run/build/install 并不天然只读，按 command profile 校验；未明确授权的组合默认 DENY。Product 默认只含 read/list/search 和 process 的只读子集，不含 run。Provider 的内部缓存写入须限定在 server-owned cache；不得借此允许工程 mutation。

依据：[OpenAI Actions production notes](https://developers.openai.com/api/docs/actions/production)。

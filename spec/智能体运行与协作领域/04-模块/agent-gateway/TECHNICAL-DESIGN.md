---
docId: AGENT-AGENT-GATEWAY-TECH-DESIGN
title: 智能体运行与协作领域｜Gateway、Actions 与 Execution 依赖
docType: module-design
authority: normative
lifecycle: active
domain: agent-runtime-collaboration
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

# 智能体运行与协作领域｜Gateway、Actions 与 Execution 依赖

---

# 1. Gateway 的领域归属

**Agent Gateway 属于智能体运行与协作领域，并且必须是独立 npm 安装/发布包。**

Gateway 不是独立 Domain，也不是 Deployment Domain 的业务能力。

业务职责：

```text
Custom GPT Action public ingress
authentication
role identity
request/schema validation
Action routing
protocol adaptation
result normalization
```

Deployment 只对该独立包进行统一生命周期编排/透传。

---

# 2. v1 唯一公网入口

```text
Custom GPT
→ Microsoft Dev Tunnel public domain
→ Agent Gateway
→ local domain public contracts
```

v1 公网 **只暴露 Gateway**。

禁止公网直接暴露：

```text
Agent Runtime
Task Service
Execution Service
Browser Extension local bridge
SQLite
Local Resource APIs
```

多个 Role 共用同一个 Gateway/Public Base URL，通过不同 role-specific Bearer Key 识别身份。

---

# 3. Public Ingress 外部依赖

**Microsoft Dev Tunnels 作为受 Module Governance 管理的 External Resource Module 提供 public-ingress logical capability。Agent Gateway 只消费该 Public Contract/shared fact，不拥有 tunnel account/login lifecycle：

```text
Dev Tunnel Module
→ install/setup/status/start/stop 自治闭环
→ setup 处理 account/login/tunnel/public URL
→ provides public-ingress capability / current public URL

Agent Gateway
→ requires public-ingress logical capability
→ owns only Gateway local listener + Carrier ingress protocol
```

Platform 只负责 Module discovery/ordering/forwarding，不复制 public URL 到 Gateway 私有配置。

Gateway 不把 Microsoft CLI 细节写进业务代码，也不把 Dev Tunnel 保存为 Agent-owned deployment unit。

---

# 4. Gateway 不拥有下游业务

Gateway：

```text
Custom GPT
  ↓
Gateway
  ├── Agent Runtime Public API
  ├── Task Domain Public API
  └── Execution Domain Public API
```

严格禁止：

```text
Gateway 直接查 Task SQLite
Gateway 直接查 Collaboration SQLite 以绕过 Agent Service
Gateway 直接执行 shell/git
Gateway 直接写文件
Gateway 自己推进 Task
```

即使 v1 为节省资源把多个逻辑模块放在同一 Node process 中，也只能通过 Public Ports/Contracts 连接。

---

# 5. Role 身份

Custom GPT：

```text
Authorization: Bearer <role-specific-key>
```

Gateway：

```text
key → authenticatedRoleRef
```

请求 body 的 `roleRef` 不能覆盖认证身份。

Browser Extension 不使用 Role Key，而使用本机：

```text
local-platform-token
```

---

# 6. Action 三层防误调用

LLM 可能选错工具，v1 必须三层防御：

```text
1. Agent Package 静态 Schema：只暴露该角色需要的 Actions
2. OpenAPI：operationId/summary/description/params 清晰区分
3. Gateway + downstream domain：最终身份/状态/权限/版本合法性
```

原则：

> 模型选择意图；包缩小选择空间；OpenAPI 解释能力；真正 Owner 决定是否合法。

避免：

```text
updateTask
changeStatus
advanceTask
executeAnything
```

使用：

```text
completeNode
waitNode
reopenNode
askPeer
replyPeer
readFile
getGitDiff
getTestResults
...
```

---

# 7. askPeer / replyPeer 路由

这两个 Action 调 Agent Runtime Collaboration Public API。

`askPeer` 目标应表达稳定参与者语义（推荐 `targetAgentPackageRef`），由 Agent Runtime 结合 Task bindings 解析实际 role/worker。

`replyPeer` 根据 `threadId` 自动确定目标。

Gateway 不自己解析 Task participant table。

---

# 8. GPT-facing business Actions

Gateway只路由Agent Package静态允许的business-purpose operation。

Product主链：

```text
getTask / TaskDocument
askPeer / replyPeer
```

不暴露Product `createTask/listRegisteredRoles/getRegisteredRole` New Task主链；Extension/application完成这些确定性动作。

Controller/Dev 与 Test/Ops：

```text
getTask / getNodeContext
startNode / completeNode / waitNode / reopenNode（按角色权限）
Execution request/result
Artifact/File Bridge
askPeer/replyPeer
```

精确矩阵见`AGENT-DOC-02-03`。

# 9. Local Resource / real Effect 归 Execution

GPT不应把所有底层fs/git/process/network/browser primitive当高频顶层Actions。业务Action表达intent，真实Effect由Execution capability/policy执行。

底层typed primitives可保留在Execution内部/Public capability surface作为确定性能力，但Gateway不形成“Tool Router AI”。

公开互联网research优先Custom GPT Web Search；Execution Network保留local/private/credentialed/exact deterministic engineering requests。

# 10. Worker Turn / Native Capability

一个WAKE允许同一Conversation连续调用`0..N` Actions。Gateway只处理每个真实Action request，不发`ACTION_FINISHED→CONTINUE`控制信号。

大型上下文优先：

```text
TaskDocument / Execution Artifact
→ File Bridge
→ Conversation / Code Interpreter
```

而不是Browser DOM大文本注入。Gateway只做File Bridge protocol/relay；physical materialization/hash由Execution。

# 11. Approval / Policy

真实副作用是否需要 Approval 属于 Execution Domain。

Agent/Gateway 不能绕过：

```text
capability registration
path boundary
side-effect classification
approval policy
authorization
```

Agent 可以请求动作，Execution 决定动作能否真实执行。

OpenAI `x-openai-isConsequential` 只控制 Carrier UI confirmation，不取代 Execution Approval。Routine platform control/intent Action 通过静态 Schema 显式标记 consequential=false；真实副作用仍由 Execution owner 判定。

---

# 12. OpenAI Actions Transport Contract

Gateway 是 OpenAI Carrier Anti-Corruption Layer，因此 **GPT-facing DTO 与内部 Domain DTO 可以不同**。Carrier 限制只停留在 Gateway adapter，不污染 Task / Agent / Execution / Model Public Contract。

## 12.1 GPT-facing request 不依赖 Custom Headers

GPT Action 不要求平台自定义 Header。以下字段必须在 typed body/path/query 中表达：

```text
idempotencyKey
correlationId
expectedTaskVersion
expectedNodeVersion
taskId
nodeId
workerRef
```

Gateway 完成认证与 normalize 后，再转换为内部 canonical request。Role API-key/Bearer auth 继续由 Action Authentication 配置提供。

## 12.2 Production hard limits

Gateway 自身 runtime validation / package conformance 必须检查：

```text
45s Action round-trip hard ceiling
request/response < 100,000 chars
TLS 1.2+
public HTTPS port 443
real HTTP 429/5xx
structured raw response
```

长时间 Execution 采用“快速接受/返回 ref → 后续查询/Worker continuation”，不让一个 Action HTTP request 阻塞到真实任务完全结束。

## 12.3 `x-openai-isConsequential`

每个 operation 必须显式声明 `true/false`，禁止依赖 HTTP method 默认值。

平台 query/control/intent operation 若自身不直接完成不可逆真实 Effect，静态 Schema 设为：

```yaml
x-openai-isConsequential: false
```

真正 Local/Browser Effect 仍经过 Execution Policy / Approval。若未来存在 Action endpoint 自身直接完成高风险外部 Effect，才把该 operation 设为 `true`。

`Always Allow` 是routine nonconsequential Action的目标主链；真实 Preview/E2E仍必须证明实际行为。Unexpected permission prompt保留为Carrier recovery，而不是恢复成每次Browser permission click主流程。

# 13. GPT Actions File Bridge

## 13.1 Ingress：`openaiFileIdRefs`

Gateway 必须专门 normalize：

```ts
interface OpenAIActionFileInputRef {
  name: string;
  id: string;
  mime_type: string;
  download_link: string;
}
```

规则：

- 最多 10 个 Conversation 文件；
- `download_link` 是约 5 分钟瞬时 locator，不持久化；
- OpenAI file id 只记 provenance/externalRef，不作为领域实体 ID；
- Gateway 不直接把不受信任 URL bytes 写入业务目录；
- 需要导入真实 bytes 时通过 Execution 的受控 File/Network mechanics 做 MIME/size/hash/scope 校验。

## 13.2 Egress：`openaiFileResponse`

Gateway 支持：

```text
inline base64 item
HTTPS relay URL item
```

约束：

```text
最多 10 files
每文件 <= 10 MB
不得返回 image/video
URL fetch 需要 Content-Type + Content-Disposition
OpenAI 单文件 fetch timeout = 10s
```

非平凡文件优先短期 opaque relay URL。Relay 只解决 Carrier transport，不拥有 TaskDocument / Execution Artifact 的业务语义。

## 13.3 Ownership

```text
Gateway   → OpenAI file protocol / normalize / relay
Task      → TaskDocument truth
Execution → physical fetch/materialization/hash/evidence
Agent     → Carrier/Role/Worker/Collaboration
Deployment→ generic Module governance only；Gateway Module owns install/setup/status/private config
```

不新增 File Service / Artifact Domain。

## 13.4 Dynamic Context

Custom GPT Worker 的大型 Task Context 优先：

```text
Worker
→ getNodeContext / getTaskDocument Action
→ Gateway
→ Task Public API
→ openaiFileResponse
→ current Conversation
```

Browser WAKE 只传小型 identity/trigger。File Bridge 失败时允许小型 bounded text fallback，但不得重新把完整 PRD/日志/代码包恢复为 DOM 注入主路径。
## 13.5 P0 File Bridge 安全配置、信任边界与错误语义

这些值是 **ProFlow v1 自身的冻结安全预算**，不是对 OpenAI 输入上限的重新定义；Gateway Module.install 将确定性预算 materialize 为自己的 runtime config，Gateway/Execution 启动时 runtime validate。Platform 不要求用户填写这些固定值：

```text
agentGateway.fileBridge.maxInputFiles          = 10
agentGateway.fileBridge.maxInputFileBytes      = 10_000_000     # 10 MB / file
agentGateway.fileBridge.maxAggregateInputBytes = 50_000_000     # 50 MB / Action ingress
agentGateway.fileBridge.inputFetchTimeoutMs    = 15_000         # per remote fetch
agentGateway.fileBridge.maxOutputFiles         = 10
agentGateway.fileBridge.maxOutputFileBytes     = 10_000_000     # OpenAI response hard limit
agentGateway.fileBridge.relayTtlMs              = 300_000        # 5 min
agentGateway.actions.maxRequestChars            = 100_000        # exclusive upper bound: serialized request MUST be < this
agentGateway.actions.maxResponseChars           = 100_000        # exclusive upper bound: serialized response MUST be < this
```

实现约束：

- `name`、`mime_type`、`download_link` 全部是 **external-untrusted hints**；Gateway/Execution 不把 filename 直接拼成本地路径。
- filename 只取安全 basename；拒绝 NUL、控制字符、路径分隔符、`..` traversal 和空名称。
- declared MIME 与实际 bytes/detected MIME 分开记录；对安全相关 mismatch 拒绝并返回 typed error，不能只信 `mime_type`。
- Carrier file fetch 仅允许 HTTPS；不得携带平台 secret/credential；redirect 每跳重新校验，禁止落到 localhost、loopback、link-local、RFC1918/private network 或 metadata endpoint，避免 SSRF。
- 下载必须流式进入 temporary staging，不要求把 aggregate bytes 一次性载入内存；超出单文件/aggregate budget 立即停止。
- relay token 必须 opaque、GET-only、**single-purpose + artifact/outputRef scoped**、TTL bounded；允许 OpenAI 在 TTL 内因 transport retry 再取同一 artifact，但 token 不能列目录、换 artifact 或暴露本地路径。
- relay 过期只重新生成 transport token；TaskDocument/Execution Artifact canonical truth 不复制到 Gateway durable store。

Gateway/OpenAI adapter 对外冻结以下 typed error codes；底层 Execution error 可作为 cause/evidenceRef 保留，但不能把内部异常栈直接透给 GPT：

| errorCode | 语义 | retry / recovery |
|---|---|---|
| `OPENAI_FILE_INPUT_INVALID` | runtime shape / filename / URL 不合法 | 修正输入，不自动 retry |
| `OPENAI_FILE_COUNT_EXCEEDED` | 输入/输出文件数超过 10 | 缩小集合 |
| `OPENAI_FILE_TOO_LARGE` | 单文件超过平台/Carrier budget | 缩小或拆分 |
| `OPENAI_FILE_AGGREGATE_TOO_LARGE` | ingress aggregate 超过 50 MB | 缩小集合 |
| `OPENAI_FILE_LOCATOR_EXPIRED` | transient input locator 已失效 | 重新取得 fresh file ref；不 replay business mutation |
| `OPENAI_FILE_FETCH_TIMEOUT` | 受控 fetch 超时且未完成 materialization | 先查 owner facts；仅安全重试 transport |
| `OPENAI_FILE_FETCH_FAILED` | fetch/network/status/redirect policy 失败 | 按原因重试或重新取得 ref |
| `OPENAI_FILE_MIME_MISMATCH` | declared/detected MIME 冲突且不允许接受 | 重新提供正确文件 |
| `OPENAI_FILE_RESPONSE_UNSUPPORTED_MEDIA` | egress image/video 等不支持媒体 | 使用 Browser/Vision 或其他正式路径 |
| `OPENAI_FILE_RESPONSE_TOO_LARGE` | egress 单文件 >10 MB | 缩小/拆分，不 inline |
| `OPENAI_ACTION_REQUEST_BUDGET_EXCEEDED` | GPT-facing request 达到/超过 100,000 chars | 在进入 owning Domain 前拒绝；缩小 control payload 或改走 File Bridge |
| `OPENAI_ACTION_RESPONSE_BUDGET_EXCEEDED` | 最终 GPT-facing JSON 序列化后 >=100,000 chars | inline 自动切 URL relay；仍超限则显式失败 |
| `OPENAI_FILE_RELAY_EXPIRED` | relay token TTL 结束 | 从 canonical truth 重新生成 relay |
| `OPENAI_FILE_RELAY_SCOPE_INVALID` | token 与目标 artifact/outputRef 不匹配 | DENY，不 retry |

`openaiFileResponse` serializer 必须对**最终序列化后的 GPT-facing JSON**计算字符预算。Inline base64 如果会使 response 达到或超过 `100,000` chars，必须在发送前切换为 URL relay；若 URL relay response 仍无法满足预算，返回 `OPENAI_ACTION_RESPONSE_BUDGET_EXCEEDED`，禁止把超限 payload 发给 OpenAI 后再依赖 transport failure。

## 当前正式约束：Gateway / Execution / Deployment

- Gateway 是 Custom GPT Actions 公网 Anti-Corruption Layer，不拥有下游业务状态，不直接触达 Local/Browser Effect。
- Dev Tunnel 改由 Deployment External Resource Module 管理；Gateway 只 Requires 一个满足 public ingress capability 的 moduleRef/逻辑能力。
- 本地/浏览器真实能力统一通过 Execution Public Contract；Gateway 不 import execution-local/browser internal implementation。
- GPT-facing transport 的 OpenAI hard limits 与 File Bridge 官方协议进入 Agent Carrier conformance；Always Allow、Multi-Action Worker Turn、Conversation-native file usage 与 Context Pack→Code Interpreter→Patch 已是 v1 REUSE/PRIMARY PATH，真实目标环境 proof 留到 FINAL MANUAL E2E。只有具体载体格式优化（例如 ZIP Context Pack）可继续保持 `PENDING_SPIKE`。

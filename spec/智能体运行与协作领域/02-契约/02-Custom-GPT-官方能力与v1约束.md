---
docId: AGENT-DOC-02-02
title: 智能体运行与协作领域｜Custom GPT 官方能力与 v1 Carrier 约束
docType: carrier-contract
authority: normative
lifecycle: active
domain: agent-runtime-collaboration
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs: []
---

# 智能体运行与协作领域｜Custom GPT 官方能力与 v1 Carrier 约束

> 校对日期：2026-08-12。此文件只记录 v1 设计实际依赖的 OpenAI Custom GPT 产品事实，避免未来实现者把“平台决定”和“Carrier 当前能力”混为一谈。产品行为可能变化，Carrier 升级时必须重新核对官方文档。

---

# 1. 官方来源

当前设计只采用 OpenAI 官方 Developers / Help Center 已明确公开的能力，主要页面：

```text
Sending and returning files with GPT Actions
Production notes on GPT Actions
GPT Action authentication
Getting started with GPT Actions
GPT Actions introduction
Creating and editing GPTs
Configuring actions in GPTs
Scheduled Tasks in ChatGPT
```

未公开或未形成稳定官方 Contract 的行为，不作为平台硬依赖。

---

# 2. GPT editor 的配置面

当前官方说明中，GPT editor 支持创建/配置 GPT，并包含：

```text
Instructions
Knowledge
Recommended model
Capabilities
Actions
```

因此 Agent Package 的 Custom GPT setup CLI 应逐项映射这些真实字段，而不是抽象成一个无法操作的“export Agent”。

---

# 3. Instructions vs Knowledge

官方区分：

```text
Instructions
→ 行为、规则、语气、工作流指导

Knowledge
→ 上传文件中的长期 Knowledge 材料
```

因此必须区分“行为规则”“静态 Role Knowledge”“动态 Task Context”：

```text
package.json agent.instructions
→ Web Instructions                                      # v1 REQUIRED

knowledge/custom-gpt-knowledge.zip
→ Mac deployment validation / isolated staging
→ Web Knowledge 上传 ZIP 本体 `custom-gpt-knowledge.zip`  # v1 REQUIRED deployment baseline

TaskDocument / Artifact / File Bridge
→ 当前 Worker 动态上下文                                # 永不进入 permanent Knowledge
```

`fixed-context.md` / `memory.md` 继续是 package authoring/reference material；是否吸收到 Knowledge Bundle 由 Agent Package author 决定，不由 Extension 推理。部署代码只消费版本化 ZIP 资产，不解释角色知识语义。

---

# 4. Recommended model / Capabilities

Recommended model 是 GPT 的推荐模型配置项；用户仍可能在可用时切换模型。

Capabilities 是 GPT 内置能力开关，具体可用项取决于账号/工作区/地区。

因此 Agent Package：

- 必须给出部署期推荐值；三个固定 Agent 当前统一为 `gpt-5-6`；
- Provisioning Driver 应自动选择 package material 声明的推荐模型并做页面 readback；
- Capabilities 同样按 package carrier profile 自动设置；
- 不应把“推荐模型一定被强制使用”写成平台安全前提；
- 关键边界仍靠 Actions/Owner 服务端校验。

---

# 5. Actions

官方当前定义：Actions 用于连接用户定义的外部 API。

Action 配置依赖两部分：

```text
Authentication
OpenAPI Schema
```

OpenAPI Schema 描述：

```text
server
endpoints
parameters
operationId
```

支持 JSON/YAML。

v1 对应：

```text
Custom GPT
→ Action
→ Agent Gateway
→ Domain Public APIs
```

---

# 6. Action Schema 导入

官方说明可：

```text
直接粘贴 Schema
从 URL 导入
从示例开始
```

v1 决策仍然是：

> 每个 Agent Package 静态维护一份 Action Schema。

即使使用 URL 导入，也不假设 GPT 会自动持续同步 URL 内容。包升级后的 Web materialization 仍由 owning `Module.setup` / Browser Extension 依据真实 Role 状态处理；机器可以完成的字段配置不得重新退回人工复制粘贴。当前 `DRIFT` 不自动 Edit 既有 GPT，而是 fail closed；需要更新 Carrier 时走显式 recreate，新 GPT 成功后再替换 current binding。

---

# 7. Action Authentication

官方 Action auth 支持：

```text
None
API Key
OAuth
```

API Key 可配置 Bearer 等模式。

v1 选择：

```text
API Key / Bearer
一个 Role 一个独立 Key
```

这是平台安全设计，不是 OpenAI 强制要求。

---

# 8. 用户控制、`x-openai-isConsequential` 与 Always Allow

OpenAI Action 的 UI confirmation 与 ProFlow 内部 Browser/Carrier Approval 是两层不同事实。`x-openai-isConsequential` 必须按 **GPT-facing operation 自身是否直接产生真实副作用** 设置，不能再因为“后面还有 Execution”统一把 mutation 描述成纯 intent。

```text
Task/Peer query、只读 Repomix/CodeGraph
→ x-openai-isConsequential:false

固定混合读写 POST /actions/localDev
→ 整个 HTTP operation 为 true，包括其 read 子操作
Product 严格只读裁剪版本才可 false，且 backend 同步拒绝 mutation/run
```

规则：

- `x-openai-isConsequential:false` 只说明当前 Action 对 OpenAI Carrier 的 consequence 语义，不赋予额外本地权限；
- 本地 Tool 最终授权仍由 Gateway Role auth、`Role × Tool × Operation` policy、server-bound Workspace、Browser Extension Effect Gate 与 `execution-local` runtime validation 共同决定；
- Browser/Carrier 内部危险 Effect 若需要 durable Approval，继续由 Execution 内部机制负责；
- unexpected permission prompt 继续作为 Browser Carrier recovery / human-interaction 情况处理；
- 不把 OpenAI permission 结果写入 Task/Execution Approval truth。

---

# 9. v1 不依赖 Custom GPT management API

当前官方资料描述的创建/编辑主流程仍是 GPT editor。本设计没有把“通过官方 API 自动 create/update/publish Custom GPT”作为 v1 依赖，也没有找到可作为本项目硬依赖的公开管理 Contract。

v1 自动化因此明确采用 **真实 Web editor + 本地已安装 Browser Extension**：

```text
Agent Package material
→ Mac deployment setup
→ execution-browser-extension Deployment Provisioning
→ ChatGPT /gpts/editor / /gpts/editor/*
→ deterministic DOM/Web materialization
→ MISSING 时 private create；READY 时复用；DRIFT fail closed
→ explicit recreate 时创建新 g-id 并替换 current binding
→ real g-id / carrier reality
```

这不是 Custom GPT management API，也不是模型控制浏览器。页面合同变化、账号/工作区不允许创建、未登录或其它 Carrier reality 不满足时必须显式失败/ACTION_REQUIRED，不得伪造成功。

如果未来 OpenAI 提供稳定官方管理接口，可以替换 Deployment Provisioning Adapter，但不改变 Agent Package / Role / Worker 核心语义。

---

# 10. validate-role 的现实边界

因为 v1 不依赖官方管理读回接口，Agent CLI 不能声称通过 OpenAI management API 读取完整 GPT 配置；但 Deployment Provisioning Driver 可以对当前真实 editor 做 bounded DOM/reality verification。

必须联合验证：

```text
Agent/Runtime owner checks:
roleRef/url 格式
package version
Role Registry
key/config
Gateway reachability
auth probe
local OpenAPI validation

Browser Provisioning checks:
live GPT reality
Instructions readback
recommended model / required Capabilities readback
Knowledge ZIP upload + file presence
Action Schema materialization
Create 前 API Key/Bearer 已保存并通过 bounded UI readback；重开 secret 仅显示 `[HIDDEN]`
```

任何 Browser check 无法确定时均不得将 Role 标为 READY；最终仍需要真实 GPT → Gateway 身份探针证明 Carrier 可工作。


---

# 11. Current page URL / Conversation c-id 不是官方 Action metadata

第一版已经明确：**GPT Action 不提供可作为 ProFlow Worker identity truth 的稳定 Conversation c-id。** 因此三个 Worker 的 `workerRef/c-id + conversationLocator` 都由 Browser Carrier 在真实页面创建/恢复时观察与验证，再通过 Task `bindTaskWorker` 固化。

```text
不得假设 GPT Action HTTP request 天然携带 window.location.href
不得假设天然携带 current Conversation c-id
不得信任模型任意自报 URL 作为可信身份
```

这不再是 Product pre-Task createTask 的阻塞 Spike，因为 Product Task creation 已移到 Extension：

```text
Extension createTask(PENDING)
→ Browser CREATE Product/Dev/Test Conversation
→ observe c-id / locator
→ bindTaskWorker
```

真实 E2E 仍需验证 ChatGPT 页面 URL/c-id observation 的具体稳定性与恢复策略，但不会改变“Browser owns Conversation identity observation、Action does not”这一架构边界。

---

## OpenAI Carrier 能力状态与 v1 边界

OpenAI Carrier 已提供的能力直接纳入 Agent/Gateway/Deployment 合同；平台只保留自身必须拥有的事实、执行、身份与恢复能力。

### A. VERIFIED_CONTRACT｜v1 Carrier 正式合同

#### A1. `openaiFileIdRefs`：Conversation → Action 文件输入

GPT Action 的文件输入参数名固定为：

```text
openaiFileIdRefs
```

单次最多 10 个 Conversation 文件。来源可包括用户上传文件、DALL·E 生成图片、Code Interpreter 创建文件。

Gateway 的 OpenAI transport boundary 必须把该字段先按 `unknown` 接收，再做专门 runtime normalization。ChatGPT 实际运行时对象形状按官方说明为：

```ts
export interface OpenAIActionFileInputRef {
  name: string;
  id: string;
  mime_type: string;
  download_link: string;
}

export type OpenAIFileIdRefsRuntime = OpenAIActionFileInputRef[];
```

注意：官方 OpenAPI 示例可能把 `openaiFileIdRefs` 声明为 `string[]`，但运行时填充为对象数组。**Gateway 不能用普通静态 DTO 直接假设二者相同。**

约束：

- `download_link` 约 5 分钟有效，只能作为瞬时下载 locator；
- 不得把 `download_link` 持久化为 TaskDocument / Evidence 的长期地址；
- OpenAI `id` 只能作为 transport provenance / externalRef，不能成为 TaskDocument、Execution Artifact 或 Worker 的业务主键；
- 文件 bytes 若要进入 TaskDocument/内部 Artifact，真实下载、大小/MIME/hash 校验与材料化继续走受控内部 materialization；这与 Repomix / Local Dev / CodeGraph Direct Tool Actions 无关，Gateway 不成为业务文件 Owner。

#### A2. `openaiFileResponse`：Action → Conversation 文件输出

Action 可以返回：

```text
openaiFileResponse
```

一次最多 10 个文件；每文件最大 10 MB；不能返回 image/video。

支持两种 item：

```ts
export type OpenAIFileResponseItem =
  | {
      name: string;
      mime_type: string;
      content: string; // base64
    }
  | string;            // OpenAI 可获取的 HTTPS URL

export interface OpenAIFileResponseEnvelope {
  openaiFileResponse: OpenAIFileResponseItem[];
}
```

URL 模式的文件响应必须包含：

```text
Content-Type
Content-Disposition
```

OpenAI 对每个返回文件的获取超时为 10 秒。

v1 规则：

- 小文件可 inline；
- 非平凡文件优先使用 Gateway 的短期 opaque relay URL；
- relay 只是 OpenAI transport adapter，不新建 File Service / Artifact Domain；
- relay 不暴露真实本机 path、credential 或业务内部 locator。

#### A3. Actions production hard limits

GPT-facing Gateway / OpenAPI conformance 必须纳入：

```text
45s round-trip hard ceiling
request < 100,000 chars
response < 100,000 chars
TLS 1.2+
public HTTPS / port 443
real HTTP 429/5xx
raw structured response
```

因此：

- 长任务不能阻塞一个 Action 请求等待全部执行结束；
- 大型 Task 文档/产物不再默认塞进 Action JSON；
- Gateway 不用 `200 + error object` 隐藏 overload/server failure；
- static OpenAPI endpoint summary/description 与 parameter description 必须遵守 OpenAI 当前长度约束并进入 conformance。

#### A4. GPT-facing transport 不依赖 Custom Headers

OpenAI Actions 不支持平台任意自定义 request headers。GPT-facing contract 不得要求：

```text
Idempotency-Key
X-Correlation-Id
X-Task-Version
X-Node-Version
X-Worker-Ref
```

Task/Peer Actions 若确有业务版本/幂等字段，继续放入 typed body/path/query；**Direct Tool Actions 不携带这些平台身份字段**，只传 `operation + input`。Authentication header 仍由 OpenAI Action auth 配置负责。

#### A5. `x-openai-isConsequential` 必须显式设置

每一个 GPT Action operation 都必须显式声明：

```yaml
x-openai-isConsequential: true
```

或：

```yaml
x-openai-isConsequential: false
```

禁止依赖 OpenAI 对 GET / 非 GET 的默认推断。

每个 HTTP operation 按其允许的最高真实 effect 静态声明。不能按 body.operation 动态切换；Local Dev 混合读写 endpoint 为 true，因而 read 也需确认。精确规则及代价见 `AGENT-DOC-02-03` §9。

```text
OpenAI Carrier confirmation
!=
Browser Extension / Local Tool authorization
!=
Execution internal Browser/Carrier Approval（仅相关 durable internal Effect）
```

三层不得混用，也不得为了同一个真实副作用重复制造审批状态机。

#### A6. Agent Package / Role capability truth

Custom GPT v1 继续使用 Actions；Apps 与 Actions 不同时作为同一个 GPT 的 P0 工具链。

Recommended model 只是 advisory，不是 Role READY 的强绑定；当前带 Actions 的 GPT 还必须使用 Action-compatible model（不把 Pro mode 作为 Actions Carrier 运行前提）。Role READY 应依据：

```text
GPT/Role exists
Actions schema installed
Action auth valid
required capabilities enabled
Gateway reachable
real Preview/E2E PASS
```

而不是 `recommendedModel == 某精确 model id`。

Custom GPT 创建/编辑仍是 Web-only Carrier 流程，但正常部署 happy path 由已安装 Browser Extension 的 Deployment Provisioning 自动完成，而不是要求用户逐字段操作。`ACTION_REQUIRED` 仅用于真正的人机前置或外部 blocker（例如首次加载扩展、未登录、Carrier capability 不可用、页面合同变化），不能把机器可完成的 Web 配置重新推给用户。

### B. PENDING_SPIKE｜官方能力存在，但本平台使用方式仍需真实 E2E

下面只验证“在我们的 Role / Worker / backend Task Reconciliation + Carrier 主链中是否稳定”，不是验证 OpenAI 文档是否存在：

```text
1. x-openai-isConsequential:false 后选择 Always Allow，后续 routine read/query Actions 是否稳定无确认；
2. 一次 Worker Turn 内连续 Action A → result → Action B 是否稳定，无需 Browser 中途再次 WAKE；
3. openaiFileResponse 返回 Task documents 后，Conversation-native file search 是否稳定满足动态 Task Context；
4. Repomix / Local Dev / CodeGraph 新 schema 在真实 GPT 上 materialize 后，Direct Tool 调用是否直接返回 Provider result。
```

通过后可把 Browser 的 routine permission click、大型上下文注入、逐 Action WAKE、无界逐文件 Action 往返进一步从 happy path 裁掉。

### C. REJECTED_OR_UNSUPPORTED｜明确不作为 v1 主路径

```text
不得假设 GPT Action request 自动提供稳定 Conversation c-id
不得用 ChatGPT Scheduled Tasks 替代 ProFlow backend Task Reconciliation + Worker Carrier 驱动
不得用 Code Interpreter 替代 Repomix / Local Dev / CodeGraph 的真实本地工程操作，也不得替代 Browser Carrier
不得因 File Bridge 删除 Browser/Vision
不得把 Custom GPT native Actions/Function Calling 等同于 Model Runtime native tool_calls
不得新增 File Domain / Artifact Domain / OpenAI Files DB
```

平台 → GPT 图片/视频不能依赖 `openaiFileResponse`；Browser screenshot / Model Vision 路径继续保留。

### D. v1 Carrier/Data Movement 原则

```text
小型结构化 Task/Peer 控制数据 → GPT Action JSON
文档 / 文件 / 大型上下文       → GPT Actions File Bridge
仓库/文件/命令/结构关系         → Repomix / Local Dev / CodeGraph Direct Tool Actions
Conversation identity/lifecycle → Execution Browser
页面真实状态 / screenshot       → Execution Browser + Vision
Browser/Carrier durable Effect  → Execution internal path
业务事实                       → owning Domain
```

这条规则的目标是复用 ChatGPT 已有能力并减少自研 transport，而不是新增一层平台架构。

---
docId: AGENT-DOC-02-05
title: 智能体运行与协作领域｜Tool Action 与 Browser Extension 执行契约
docType: contract
authority: normative
lifecycle: active
domain: agent-runtime-collaboration
contractRefs:
- PLATFORM-DOC-01-01
- PLATFORM-HOST-COMPOSITION-ROOT
---

# Tool Action 与 Browser Extension 执行契约

## 1. 冻结链路

GPT-facing 本地工具只固定三类：`Repomix / Local Dev / CodeGraph`。它们不是 MCP，不通过动态 Tool Runtime，也不是 Execution Capability。

正式物理链路统一为：

```text
Custom GPT Action
→ Agent Gateway
→ ProFlow API / platform-host application API
→ Browser Extension
→ 本机 Tool implementation
→ macOS 本机资源
→ Result 原路返回 GPT
```

Browser Extension 是 GPT 调用用户本机资源的统一物理执行入口。platform-host 不得绕过 Extension 直接调用本机工具实现。
## 2. GPT-facing Action

```text
POST /actions/repomix
POST /actions/localDev
POST /actions/codeGraph
```

请求只表达：

```json
{
  "operation": "<operation>",
  "input": { "...": "业务参数" }
}
```

模型不提交 `taskId/nodeId/runNo/workerRef/roleRef/executionRef` 作为工具调用身份。Bearer 由 Gateway 认证 Role；Workspace、安全策略和 Browser Extension 目标由平台当前部署事实绑定。

## 3. Browser Extension 的职责与隔离边界

Browser Extension 不只是 ChatGPT 页面 Carrier，也是 GPT→Mac 本机资源的统一 Effect Gate。它接收 ProFlow API 发来的 typed Tool Command，完成调用前边界校验、Local Tool command 转发、结果/UNKNOWN 回报。

Local Tools **不得与 Browser/Carrier/Observer/Collaboration 共用 command queue、串行 command loop、dispatcher、state machine、retry、lock 或页面状态**。当前 Browser `runBridgeLoop()` 会串行等待 command result，Local Dev `run/process` 不能进入该 lane，否则长命令会阻塞 Browser/Carrier。

扩展侧必须形成两条并行 lane：

```text
Browser lane（保持现有行为）
existing /v1/commands/*
→ runBridgeLoop
→ Browser/Carrier dispatcher

Local Tool lane（新增、独立）
/v1/local-tools/commands/*
→ runLocalToolBridgeLoop
→ Local Tool dispatcher
→ local-tool bridge client
→ execution-local
```

两条 lane 最多共享 Extension identity、token 派生/认证 primitive、基础 loopback 配置与通用日志 helper；queue、pending map、timeout、readiness、error/backoff 必须独立。Local Tool lane 挂死/超时不得阻塞 Browser lane heartbeat/poll/WAKE/submit。无需引入共享 command-family router；现有 Browser `/v1/commands/*` 热路径保持原样，新链只新增 `/v1/local-tools/commands/*`。

禁止把 `LOCAL_TOOL` 堆进现有 Browser `executeCommand()`；禁止修改 Browser command schema 来容纳 Local Tool；禁止 Local Tool 模块 import Task Observer、System Observer、Collaboration Carrier、ChatGPT DOM adapter 或 Browser session state。

Browser Extension 不在浏览器 JS 沙箱里直接实现文件系统/Git/进程；它通过独立、受控的本机 local-tool bridge client 调用本机工具实现。该 bridge 不是 GPT-facing MCP。

Bridge runtime 生命周期归 `execution-browser-extension` 模块自身，而不是 `execution-runtime`。它必须在 `execution-runtime` DOWN 时仍可保持 Extension session 与 Local Tool lane READY；`execution-runtime` 仅作为 Browser lane 客户端，platform-host/API 仅作为 Local Tool lane 客户端。两者都不得通过拥有 bridge lifecycle 来把另一条 lane 的 readiness 绑死。

## 4. 本机工具实现

物理实现归 `@tomflow/proflow-execution-local` 扩展包，按三个产品工具组织：

```text
execution-local/
├─ primitives/          # fs/path/search/process/command/git；不依赖 Execution DTO/lifecycle
├─ local-dev/           # read/list/search/mutate/run/process
├─ repomix/             # pack/grep/read
├─ codegraph/           # v1 仅 explore
└─ execution-adapter/   # 仅内部 durable Execution caller 使用
```

`File / Git / Process / Shell` 不再作为 GPT-facing Capability Family 平铺，全部属于 Local Dev。当前旧 `createLocalExecutor()` 是 Execution-shaped API；Direct Tool 实现不得直接复用它的 `ExecuteCapabilityRequest/ExecutionEvidence/onEffectStarted/reconcile` envelope，而应调用与 Execution lifecycle 解耦的 primitives/provider ports。

同一物理 package 可以被 Direct Tool 与内部 Execution 两条入口复用，但两条入口的 DTO、queue/readiness、result/error/handle 必须独立。`execution-local` 的包名不意味着请求必须经过 `execution-runtime`。本轮 GPT Tool Action 的正式入口是 Browser Extension；`execution-runtime` 只保留仍确实需要 durable Browser/Carrier/Approval/UNKNOWN 语义的内部机制。

## 5. 统一调用原则

三种本地 Tool 都走同一 Extension 通道，避免 read 与 mutation 形成两套架构。read-only 可以轻量同步返回；mutation/command 必须保留副作用前置校验、结果不确定三分和 no-blind-replay。
## 6. v1 operation 基线

```text
Repomix
├─ pack
├─ grep
└─ read

CodeGraph
└─ explore

Local Dev
├─ read
├─ list
├─ search      # 仅窄域、当前磁盘实时查找；不承担仓库上下文构建
├─ mutate      # create/write/edit/mkdir/move/delete
├─ run         # one-shot command；Git/test/build/install 等都走这里
└─ process     # list/ports/status/start/read/input/stop
```

Local Dev 不复制 Repomix 的广域仓库读取/上下文聚合能力；Repomix 负责“读懂仓库”，CodeGraph 负责结构关系，Local Dev 负责当前磁盘真值、mutation、command 与 process/port reality。

每个 Action 使用 `operation` discriminator + 精确 schema/`oneOf`，不允许任意 object 透传。

## 7. 安全、结果与可用性

- Gateway 负责 Bearer→Role 与公开 Action surface；
- ProFlow API 负责 role/action admission 与 typed command；
- Browser Extension 是本机 Effect Gate，并绑定当前可信本机 bridge；
- `execution-local` 负责路径、命令、进程、Git、仓库等真实 macOS 操作安全；
- Workspace root 由本机部署配置绑定，GPT 不得任意扩大；
- mutation lost response 无法确认时返回 UNKNOWN，先观察现实再决定下一步；
- `outputId/processId/searchId` 等工具原生句柄可以存在，但不是 `executionRef`；
- Extension/本机 bridge/具体 Tool readiness 分层报告，一个工具不可用不得伪装整个平台成功。

## 8. 硬 STOP

出现 Host→本机工具直连、GPT-facing MCP、Capability/Execution polling、绕过 Browser Extension 的本机副作用路径，均视为架构漂移。

## 9. 本次审计冻结：可信 command 与不可绕过的执行入口

GPT body 仍只有 operation/input；strict schema 拒绝额外身份字段（包括 actorRef）。内部 command 另含 `commandId、bridgeGeneration、authenticatedRole、workspaceBinding、tool、operation、input、deadline`，均由受认证入口和部署配置产生，绝不要求 Task admission。Role/Workspace 不是 GPT 可覆盖的 input。

Bridge 的 Host credential 只允许 enqueue / 等待该请求结果；不能 poll、claim、execute、report 或伪装 Extension。Extension Local Tool credential 与 Host credential、Browser lane credential 权限分离。共享认证算法不等于共享权限。Origin 仅作为浏览器侧附加校验，不能当作 Node caller 不可伪造的身份。

Local Tool bridge 仅在 Extension 已领取同一 command 并通过 Gate 后接受 execute；执行请求必须同时匹配 current generation、commandId、Role/Workspace/Tool/完整参数摘要与 deadline。Bridge 从已接收的 typed command 获取原始参数，不能让 Extension 或 Host 在执行阶段换参。重复 execute 至多返回同一 transient pending/result，绝不再次启动 effect；不存在接受 Host token 的 provider invoke 路由。内部 Execution materialization credential 不能被 GPT Tool route 调用。

这些检查只需独立 lane 内的 bounded transient pending map，不新增业务 Record/Store、Execution identity 或 GPT polling。Bridge/Extension 任一重启后旧 generation 全部失效；失联 mutation 返回 UNKNOWN，不从日志恢复重放。威胁边界是受认证协议角色与 GPT 输入，不声称抵御能任意读取本机同一 OS 用户凭据的恶意宿主进程。

## 10. Deadline、返回与原生句柄

Gateway 创建端到端 deadline：总预算不超过 40s，为 OpenAI 45s ceiling 留传输余量；Host/Extension/bridge/provider 只缩短剩余预算，不逐 hop 重新计时。排队时过期且尚未 dispatch 的请求移除并返回 NOT_APPLIED；已经跨 Gate 或无法排除 effect-start 的超时/断连只能 UNKNOWN。迟到 command 不得执行；迟到结果不得完成另一个 request。Gateway/Host/Extension 不自动重投 mutation。

`run` 为 bounded one-shot；超出预算停止受管 process tree，停止本身不证明文件副作用未发生。长任务必须由 `process.start` 快速返回 processRef，后续通过 process 原生接口读取；不是等待一个通用 Tool execution 完成。其他 Provider 无法在预算内给出 bounded result 或已定义原生 handle 时，operation 返回自身 unavailable/unsupported，不新增通用异步 Task。

handle 绑定 server Workspace、authenticated Role、Provider 与 generation，opaque、bounded TTL/数量/输出大小；跨 Role/Workspace、过期或 restart 后不可恢复句柄 fail-closed。`outputId` 只读既定缓存结果，不能变成任意路径。managed processRef 绑定 PID + 启动身份，不向任意 PID 提供 input/stop。list/ports 对外部进程只提供有权限的只读观察；process 数据、命令参数与输出须 redaction。

Result 区分 confirmed result / rejected-before-effect / TOOL_RESULT_UNKNOWN；error 不得暴露 token、内部 endpoint 或完整堆栈。大结果截断或 Tool 原生分页不能退回 Execution readOutput。

## 11. Consequential 的 HTTP 粒度

2026-09-13 用户裁决：Product / Controller-Dev / Test-Ops 三个 shipped Custom GPT 中，所有 Action operation 均显式 `x-openai-isConsequential:false`，包括 Dev/Test 的混合 `localDev`。该字段只控制 OpenAI Carrier UI confirmation，**不承担本机授权**。Local Dev mutation/run/process 仍必须经过 Gateway Role admission、Extension Effect Gate、Workspace/参数边界、provider safety、deadline 与 UNKNOWN no-blind-replay；不能因为 Carrier metadata 为 false 而绕过任何内部安全控制。

## 2026-09-09 用户裁决：默认 Workspace 与 trusted command

Local Dev 使用 trusted local developer command 模型。Workspace 是 server-bound 默认操作范围，不是 OS sandbox。ProFlow 能明确识别的外部 path/cwd、跨 Workspace move/copy、另一个 repo 或显式外部文件参数，必须在 Effect 前由 Extension 向用户明确提示规范化越界目标；提示后继续执行，不等待批准，也不因缺少越界批准而拒绝。不能静默扩大默认范围。

获准的 pnpm/npm test/build/install、git、node/python、repo script/lifecycle/hook 继承当前 macOS 用户权限。平台不承诺阻止脚本内部访问 Workspace 外部；不要求 container、VM、mandatory sandbox 或新增 Approval Runtime。认证 Role×Tool×Operation、canonical path/symlink 检测、受保护 credential、env redaction、deadline、managed processRef、generation/digest 校验与 UNKNOWN no-blind-replay 继续有效。

越界提示关联当前 commandId/generation、Role、Workspace、Tool/operation、完整参数摘要和规范化越界目标；参数/目标变化时提示实际目标。提示无需用户确认，不引入 approved 字段或越界批准状态。Extension Effect Gate 仍校验身份、参数和 deadline；过期 command 不重启，UNKNOWN 不盲重放。提示不创建 Execution Record，也不赋予任意 PID 控制权。明确危险操作的独立确认规则继续有效。

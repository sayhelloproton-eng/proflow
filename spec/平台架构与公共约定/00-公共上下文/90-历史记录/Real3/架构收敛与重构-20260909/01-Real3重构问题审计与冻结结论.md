# Real-3 重构问题审计与冻结结论

> 性质：CURRENT DESIGN DECISION
> 来源：原始独立全量审计、最近 Action/Gateway/Host/Execution 逐项讨论、当前源码交叉核验。
> 本文只负责“为什么改、改到什么边界”；具体怎么改只看 `02-Real3重构执行计划书.md`。

## 1. 真实需求

ProFlow 的业务目标很简单：

```text
各职能 Agent 围绕 Task / Node 协作
→ 读取和提交正式 TaskDocument
→ 必要时 askPeer / replyPeer
→ 按配置使用用户本地工具
→ Extension + Model 驱动真实 Conversation
→ Node 自动流转到 Task terminal
```

Agent 需要足够上下文和工具自由度，不需要学习平台内部执行协议。

## 2. 已冻结的模型侧概念

| 概念 | 模型需要知道什么 |
|---|---|
| Task | 任务目标、整体事实、当前进度 |
| Node | 当前轮到自己做什么、节点状态 |
| Document | 正式阶段输入/输出资产 |
| Peer | 与其他职能 Agent 提问/回复 |
| Tools | Repomix / Local Dev / CodeGraph 的真实能力和结果 |

除此以外，不再新增 GPT 产品心智。

## 3. 必须重构的确认问题

| 问题 | 当前表现 | 为什么必须改 |
|---|---|---|
| GPT-facing Execution 过重 | `executeCapability → getExecution → readExecutionOutput` | 模型承担 executionRef、状态机、轮询、分页和恢复；Action 往返多、吞吐低 |
| Capability 抽象泄漏 | 模型先选 capability 再拼 Execution request | 模型真正需要的是直接工具，不是平台内部能力注册表 |
| 工具被 Task identity 绑死 | 旧 execute path 要 `taskId/nodeId/runNo` 并做多次 Task admission | 本地工具本身与 Task 无关；把工具绑进 workflow 降低自由度并制造重复查询 |
| Host 重复 admission | Host 校验后 Execution 又回 Host identity authorize | 同一请求重复跨层验证，简单 read 被放大 |
| `getNodeContext` 被污染 | Node context 附加 capability/schema/executionRequestContext | “这一棒做什么”被变成“教模型怎么操作 Execution” |
| Execution 领域过宽 | normative 声称唯一 real-world effect plane，并包住本地文件/代码工具 | 新方案要求 Local Dev/Repomix/CodeGraph 直接拥有自己的工具执行语义 |
| Host readiness 耦合过重 | Host composition/readiness 强依赖 Execution + Model | Model/Execution 非必要故障会拖垮 Task/Peer/直接 Tools |
| Recovery 所在生命周期不稳 | Task progression/recovery 依赖 MV3 background 调度 | Extension 短命，Dev→Test 自动接棒不能靠页面事件碰运气 |
| 文档重复 | 原始独立审计、旧文件级计划、新执行书重复描述同一 migration | authority 不清，后续 Chat 容易按旧 Capability 方案继续实现 |

## 4. 工具边界最终裁决

### 4.1 Tools 是 Task-agnostic

本地 Tool Action 的调用身份只需要 Gateway 已认证的 `Role` 与平台固定的 Workspace/Extension/local-tool 配置。

**工具请求不得要求：**

```text
taskId
nodeId
runNo
workerRef
roleRef
executionRef
idempotencyKey（平台 Execution 语义）
```

Task/Node 关联不是工具执行前置。如果未来为了分析日志希望关联 Task，只能通过受信的外围事件或时间/correlation 做非阻塞 enrichment，不能重新成为 admission 条件。

### 4.2 三类工具就是产品工具面

- Repomix：`pack / grep / read`，基线语义对齐当前真实 `pack_codebase / grep_repomix_output / read_repomix_output`。
- Local Dev：`read / list / search / mutate / run / process`；其中 `process` 覆盖进程/端口/长任务，`run` 承担 Git/test/build/install 等 one-shot command，`search` 只做窄域当前磁盘查找，不复制 Repomix 的广域上下文能力。
- CodeGraph：v1 GPT-facing 只保留 `explore`，内部可使用 caller/callee/dependency/impact 等成熟 library 能力生成结构结果。

工具自己的 outputId/processId/searchId 属于原生结果句柄，可以存在；它们不是 ProFlow Execution 心智。

### 4.3 工具安全、Extension Gate 与日志

- Gateway Bearer 只证明 Role；工具权限按 `Role × Tool × Operation` 配置。
- Workspace root 由服务端绑定，GPT 不传任意 projectRoot 来扩大范围。
- 所有 GPT-originated macOS Tool 调用统一经过 Browser Extension Effect Gate；Host/API 不得直接触达 fs/git/process/shell/Repomix/CodeGraph。
- Extension Local Tool 分支只共享最外层 command transport/identity primitive，不共享 Browser/Carrier/Observer/Collaboration 的 dispatcher、状态机、锁、retry 或页面 session。
- `execution-local` 负责真实本机 Tool implementation 与路径/命令/进程等底层安全；ProFlow 不复制旧 Execution Capability lifecycle。
- API/Host 生成 correlation 并落工具调用日志；日志不是 Task/Execution 第二真源。
- mutation transport timeout 不能盲重试；返回明确 UNKNOWN 类结果后，由 Agent 用工具重新观察真实现场。

## 5. Task / Document / Peer 边界

- `getTask/getNodeContext/startNode/completeNode/waitNode/failNode/reopenNode` 继续属于 Task Owner。
- `getTaskDocument/putTaskDocument` 继续属于 Task Owner；Document 不是 Local Dev 文件操作的别名。
- `putTaskDocument(openaiFileIdRefs)` 的物理下载/materialization 可以继续复用内部机制，但 GPT 不需要先调用 Local Dev 或 Execution。
- `askPeer/replyPeer` 保持 Agent collaboration 语义；物理 Browser delivery/retry 对模型透明。

## 6. Execution 收窄后的定位

Execution 不再是 GPT 本地工具的必经面。当前 durable core 只保留仍然有真实价值的内部场景：Browser Carrier/WAKE、物理 collaboration delivery、Approval/UNKNOWN recovery、外部文件 materialization 等。

不为了名称整洁立即重写全部 Execution 存量；先切断 GPT-facing Execution 主链，再用引用/行为证据删除真正死代码。

## 7. Gateway / API / Extension 边界

```text
GPT Action
→ public HTTPS / Tunnel
→ Gateway：Bearer→Role、transport、rate/error boundary
→ ProFlow API：Task/Peer route 或 Local Tool admission/typed command
→ Browser Extension：统一 Local Effect Gate
→ isolated local-tool bridge
→ execution-local（Repomix / Local Dev / CodeGraph）
→ macOS
```

本地 Tool route 的目标调用计数：

```text
GPT Action round-trip = 1
Task Owner query = 0
旧 Execution lifecycle call = 0
Extension Effect Gate = 1（强制）
```

Extension 与本机 local-tool bridge 的受控 loopback 是正式安全/物理边界，不以“减少一次 HTTP”为理由绕开。现有 Browser `/v1/commands/* + runBridgeLoop()` 保持原样；Local Tool 使用独立 `/v1/local-tools/commands/* + runLocalToolBridgeLoop()`，两条 lane 不共享 queue/pending/timeout/backoff，只共享 Extension identity/auth/loopback primitive 与通用日志 helper。

## 8. 自动流转边界

Task Owner 仍是 workflow truth。Dev `completeNode` 后 Test READY 必须由后端 durable facts + bounded reconciliation 最终重新发现；Extension 的 progression 分支只负责 Conversation/permission/submit/receipt/page reality，同时保留与该分支完全隔离的 Local Tool Effect Gate。

Tools 不自动推进 Task。Agent 判断工作完成后显式调用 `completeNode/waitNode/failNode`。

## 9. 文档去重裁决

旧 `Real3架构收敛与重构文件级执行计划` 与原始独立审计中的历史 target/migration 已被当前冻结结论和 `02-Real3重构执行计划书.md` 完整替代，因此不再保留副本，避免后续重新引入已废止的 Capability/Execution/SAME-SCENE 方案。

部署手册只拥有“真实 Workspace 怎么部署”；模拟人工前置只拥有“环境是否已准备好/当前 blocker”，不再重复完整部署 SOP。

## 10. 本轮硬 STOP

出现任一项立即回退到设计 Gate：

- 直接工具 Action 又要求 Task/Node/Worker/Execution 字段；
- 为普通工具结果重新引入 getExecution/polling/readOutput；
- Host/API 绕过 Browser Extension 直接调用本机 Tool；
- Local Tool 分支侵入 Browser/Carrier/Observer/Collaboration dispatcher、状态机、锁或页面 session；
- Extension→local-tool→execution-local 真实链尚未证明，就先写大量假 client；
- `putTaskDocument` 改成依赖 Local Dev；
- Model/旧 Execution Runtime 非必要故障仍阻塞 Tool/Task/Peer；
- UNKNOWN mutation 自动重试；
- static/regex test 被当成真实 Behavior PASS；
- 每修一个 seam 就发布/部署一次。

## 11. 2026-09-09 源码反向审计补充

源码确认现有 `Browser Reality Bridge` 已有 authenticated loopback、Extension heartbeat、command queue/pending/timeout 与 result correlation，Extension→Mac 不需要 Native Messaging/MCP/新 daemon 协议。但当前正式 lifecycle 由 `execution-runtime` 的 `createFormalExecutionRuntimeLifecycle()` 间接创建/关闭 `createBrowserExecutorComposition()`，若原样复用会导致 `Execution Runtime DOWN → Bridge DOWN → Direct Tools DOWN`，与本轮 readiness 隔离冲突。

冻结修正：Bridge runtime lifecycle 归现有 `execution-browser-extension` 模块自身；该模块独立启动/停止并发布 endpoint/credential/readiness。`execution-runtime` 只作为 Browser lane client，platform-host/API 只作为 Local Tool lane client。两条 lane 仍保持独立 queue/pending/timeout/backoff/dispatcher，停止 Execution Runtime 不得中断 Extension session 或 Local Tool lane。

同时确认当前 `execution-local.createLocalExecutor()` 仍是 Execution-shaped API；Direct Tool 不得薄包复用该 envelope。必须先下沉与 Execution lifecycle 解耦的本机 primitives/provider ports，再分别提供 Direct Tool adapters 与 internal Execution adapter。该拆分复用实现，不新增产品概念或独立 package。

Module dependency graph 也存在旧方向：当前 Browser Extension descriptor `requires: execution`，而 Execution Runtime 的真实启动代码反而读取 Browser Extension shared facts，属于 hidden reverse dependency。冻结修正为：Browser Extension 移除 `requires: execution` 并提供 `execution-browser-executor + local-tool-bridge`；Execution Runtime 依赖前者，platform-host 依赖后者。`requires` 会进入 Platform CLI dependency graph，因此这不是文档措辞问题，而是实现前必须修正的依赖边。

backend Task Observer/Reconciliation 也有现实落点：platform-host 已装配 Task Owner，并已有 `getTaskDriveProjection`、role binding、Execution current fact/readiness 等读取边界，因此只需 application-level deterministic decision + bounded catch-up，不新增 Scheduler Domain/通用事件总线。

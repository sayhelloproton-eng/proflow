# Real-3 重构执行计划书

> 状态：CURRENT IMPLEMENTATION AUTHORITY
> 上游决策：`01-Real3重构问题审计与冻结结论.md`
> 下游部署：`03-工作区重新部署手册.md`
> 原则：先规范和真实 Tool/Extension contract，再改 Action/API/Extension；一个 hardening batch 完成后才 release，不再 blocker→patch→publish→replay。

## 0. 完成定义

本轮只有同时满足以下条件才算重构完成：

1. GPT-facing `executeCapability/getExecution/readExecutionOutput` = 0。
2. GPT 工具心智只有 Repomix / Local Dev / CodeGraph，工具请求无 Task/Node/Worker/Execution 身份字段。
3. `getNodeContext` 只返回 Node 工作上下文，不再注入 Execution contract/schema。
4. 简单 `localDev.read`：1 次 GPT Action，0 次 Task Owner query，0 次旧 Execution lifecycle call；物理调用必须经过 Browser Extension Effect Gate。
5. TaskDocument 与三工具完全解耦。
6. Dev complete 后 Test READY 可在丢页面事件/Extension restart 后被系统重新发现。
7. Model 或旧 Execution Runtime 的非必要故障不阻塞 Task/Peer/local Tools；Extension/local-tool bridge/具体 Tool 各自按 operation readiness 报告 unavailable。
8. Repomix / Local Dev / CodeGraph 在 candidate 前各完成至少一次真实 Extension→local-tool→macOS smoke。
9. full behavior + `pnpm check` PASS 后才形成 frozen candidate。
10. frozen candidate 在 `/Users/agent/Desktop/proton-workspace` 重新部署并完成真实 Agent 协作验收。

## 1. 执行纪律与批次边界

每个 Step 统一走：

```text
CodeGraph/批量事实读取
→ 本 Step 变更清单冻结
→ 一次 coherent batch 修改
→ targeted tests/typecheck
→ Git diff + 搜索遗漏
→ Step Gate
```

Step 1～9 期间不发布 Registry、不采用到真实 Product Workspace。非幂等 publish/install/start 发生 UNKNOWN 时先回 authority，禁止盲重试。

---

## 2. Step 1｜全量对齐 normative：先把旧 Execution 工具观念清掉

### 修改文件

平台公共：

- `spec/平台架构与公共约定/01-架构/02-platform-host-Composition-Root.md`
- `spec/平台架构与公共约定/02-契约/01-公共契约与数据约定.md`
- `spec/平台架构与公共约定/02-契约/02-API与事件约定.md`
- `spec/平台架构与公共约定/02-契约/03-版本与兼容性约定.md`

Agent：

- `spec/智能体运行与协作领域/01-领域/02-统一语言与领域模型.md`
- `spec/智能体运行与协作领域/01-领域/03-当前设计原则与非目标.md`
- `spec/智能体运行与协作领域/02-契约/01-Public-API与跨领域接口矩阵.md`
- `spec/智能体运行与协作领域/02-契约/02-Custom-GPT-官方能力与v1约束.md`
- `spec/智能体运行与协作领域/02-契约/03-角色Action静态权限矩阵.md`
- `spec/智能体运行与协作领域/02-契约/04-API-依赖-模块清单.md`
- `spec/智能体运行与协作领域/03-流程与数据/07-Worker-Turn与GPT原生能力使用边界.md`

Execution：

- `spec/执行领域/01-领域/02-领域职责边界与非目标.md`
- `spec/执行领域/01-领域/03-当前设计原则与不变量.md`
- `spec/执行领域/02-契约/01-Public-Contract与TypeScript类型规范.md`
- `spec/执行领域/02-契约/02-跨领域接口依赖矩阵.md`
- `spec/执行领域/04-模块/execution-local/TECHNICAL-DESIGN.md`
- `spec/执行领域/04-模块/execution-runtime/TECHNICAL-DESIGN.md`

### 必须改成的统一说法

- 五概念 = Task / Node / Document / Peer / Tools。
- Direct Tools 不属于 Execution Capability；不经过 Execution Runtime。
- 不引入动态 MCP runtime/tool discovery；这里只接三种固定、配置化 Provider API，语义对齐当前已用工具。
- Execution 从“唯一 real-world effect plane”收窄为 Browser/Carrier/内部 durable effect/recovery owner；Local Dev Provider 自己拥有本地文件/进程 effect 语义。
- OpenAI `x-openai-isConsequential` 按 Tool operation 的真实外部 effect 设置；不再写“Action 只提交 Execution intent 所以统一 false”。
- `getNodeContext` 不再携带 Execution inventory/schema/context。
- Tool 请求不包含 Task/Node/Worker/Execution 字段。

### Gate

对 active/normative（排除 `90-历史记录`）搜索：旧三 GPT Execution Actions、`Capability first`、`所有真实 Effect 最终进入 Execution`、`MCP 重新进入主链` 等说法不得与新边界冲突。冲突数必须为 0 才进入 Step 2。

---

## 3. Step 2｜冻结 Tool / Browser Extension / Local Runtime Contract

这是实现稳定性的前置，不允许跳过。

### 规范真源

- `spec/智能体运行与协作领域/02-契约/05-Tool-Action与Browser-Extension执行契约.md`

### v1 Tool operation 基线

```text
Repomix: pack / grep / read
CodeGraph: explore
Local Dev: read / list / search / mutate / run / process
```

Local Dev 的 `process` 子操作至少覆盖 `list/ports/status/start/read/input/stop`；Git/test/build/install 等 one-shot 操作统一走 `run`。Local Dev 不复制 Repomix 的广域仓库上下文能力。

### 固定物理链

```text
Action → Gateway → ProFlow API → Browser Extension
→ isolated Local Tool dispatcher → authenticated local-tool bridge
→ execution-local → macOS
```

这里不是 MCP，也不建立动态 Tool Runtime。Repomix 优先复用官方 Node library；CodeGraph 优先复用官方 Node library；Local Dev 以 DesktopCommanderMCP 的成熟 file/search/process 实现为上游参考，裁掉 MCP transport 与和 Repomix 重叠的广域读取。

### Extension 隔离 Gate

Local Tools 只允许复用 Extension identity/token 派生、loopback/认证 primitive 与通用日志 helper；**不得与现有 Browser/Carrier 共用 command queue 或串行 `runBridgeLoop()`**。Local Tool 必须有独立 `/v1/local-tools/commands/*` lane、独立 `runLocalToolBridgeLoop()`、queue/pending/timeout/readiness/backoff、dispatcher、local-tool bridge client 与错误域。Local Tool 挂死/超时不能阻塞 Browser heartbeat/poll/WAKE/submit，也不得依赖 Observer/Collaboration/page session。

Bridge runtime 生命周期归现有 `execution-browser-extension` 模块自身，不再由 `execution-runtime` formal process 创建/关闭。`execution-runtime` 仅连接 Browser lane；platform-host/API 仅连接 Local Tool lane。必须证明停止 Execution Runtime 后 Extension session/Local Tool lane 仍可工作；否则 readiness 解耦不成立。

### 配置与 readiness

Workspace、Role policy、Extension identity、local-tool bridge endpoint/token 与 Tool enabled 状态均由部署事实绑定，不由 GPT body 提交。Extension、local-tool bridge、Repomix、Local Dev、CodeGraph 分层 readiness；某一 Tool 不可用不得让 Task/Peer/其他 Tool 全局失效。

### Gate

在写业务实现前，先证明当前 Extension command/result transport；再分别证明 `Extension → local-tool bridge → execution-local` 的最小真实调用。三 Tool candidate 前各做一次真实 macOS smoke；禁止 fake Provider/假 HTTP 代替真实链路。

---

## 4. Step 3｜重写三个 Role 的 Custom GPT Action Schema

### 修改文件

- `packages/agent-product/actions/custom-gpt.openapi.yaml`
- `packages/agent-controller-dev/actions/custom-gpt.openapi.yaml`
- `packages/agent-test-ops/actions/custom-gpt.openapi.yaml`
- 三个 Role `context/fixed-context.md`
- `packages/agent-product/tests/agent-product-static.test.ts`
- `packages/agent-controller-dev/tests/agent-controller-dev-static.test.ts`
- `packages/agent-test-ops/tests/agent-test-ops-static.test.ts`
- `packages/agent-controller-dev/tests/journey-native-capability-alignment.test.ts`（改名/重写为 tool alignment）
- `packages/agent-test-ops/tests/journey-native-capability-alignment.test.ts`（改名/重写为 tool alignment）
- `packages/execution-browser-extension/tests/custom-gpt-provisioner.test.ts`

### 删除 GPT-facing

```text
/actions/executeCapability
/actions/getExecution
/actions/readExecutionOutput
ExecuteCapabilityInput
Execution capability/schema/request context 指导
```

### 新增 GPT-facing

保持三种工具心智，而不是几十个顶级 Action：

```text
/actions/repomix
/actions/localDev
/actions/codeGraph
```

每个 Action 用 `operation` discriminator + 精确 `oneOf` input。不得退化成任意 object；也不得把 Provider endpoint/auth/workspace/task identity 暴露进 schema。

Product 默认只开放配置允许的只读调查 operation；Dev/Test 按角色配置开放读写/命令。OpenAPI 是“可见能力上限”，Host policy 是最终 Role×operation 防线。

### OpenAI Carrier Gate

- 每 operation 显式 consequential。
- schema 总大小、request/response `<100k chars`、45s ceiling 与 File Bridge 约束机械测试。
- Custom GPT provisioning 测试证明实际物化的 schema 已更新，而不是只改仓库 YAML。
- 旧三 Execution operationId 在三个 Role schema = 0。

---

## 5. Step 4｜API → Browser Extension → Local Tool 隔离链

### 修改/新增重点

- `packages/platform-host/src/role-operations.ts`
- `packages/platform-host/src/index.ts`
- Browser Extension 新增独立 Local Tool command lane（保持现有 Browser command lane 不变）
- `packages/execution-browser-extension` 增加独立 bridge runtime lifecycle；不再由 `execution-runtime` 创建/关闭 Browser Reality Bridge
- `packages/execution-browser-extension/deployment/descriptor.ts`：移除 `requires: execution`；继续 provide `execution-browser-executor`，新增 provide `local-tool-bridge`
- `packages/execution-runtime/deployment/descriptor.ts`：新增 `requires: execution-browser-executor`
- `packages/platform-host/deployment/descriptor.ts`：新增 `requires: local-tool-bridge`，同时按 Step 5 去掉与 operation-scoped readiness 冲突的无关硬依赖
- `packages/execution-browser-extension/deployment/adapter.ts` / shared facts 发布 bridge endpoint、credential、Browser lane readiness、Local Tool lane readiness
- NEW 独立 Local Tool dispatcher
- NEW 独立 local-tool bridge client
- `packages/execution-runtime` 改为 Browser lane client，不再拥有 bridge lifecycle
- `packages/execution-local/**` 三 Tool 实现

### 路由算法必须固定为

```text
Gateway authenticatedRoleRef
→ ProFlow API role/action admission
→ typed LOCAL_TOOL command
→ dedicated `/v1/local-tools/commands/*` Extension lane
→ `runLocalToolBridgeLoop()`
→ isolated Local Tool dispatcher
→ authenticated local-tool bridge client
→ execution-local
→ macOS
→ result 原路返回
```

Host/API 只负责公开 Action admission、typed command 与 audit correlation，**不得直接 import/call Repomix、Local Dev、CodeGraph、fs、git、process 或 shell**。

Extension Local Tool 链不得读取 Browser tab/session、Task Observer、System Observer、Collaboration Carrier 状态；现有 Browser dispatcher 也不得 import Local Tool implementation。两条 lane 不需要共享 command-family router，只共享 Extension identity/auth/loopback primitive 与通用日志 helper。

### 失败语义

- schema/role denied → typed 4xx；
- Extension offline → `EXTENSION_UNAVAILABLE`；
- local-tool bridge unavailable → `LOCAL_TOOL_BRIDGE_UNAVAILABLE`；
- Tool unavailable → `TOOL_UNAVAILABLE`；
- mutation lost response → `TOOL_RESULT_UNKNOWN`，禁止自动重放，Agent 通过 read/status/diff 重新观察现实。

### Gate

受控 `localDev.read(package.json)`：1 次 Action、0 Task Owner query、0 旧 Execution lifecycle call；调用轨迹必须包含 Extension Effect Gate。并通过结构测试证明 Host 无本机工具 bypass，Local Tool dispatcher 与 Browser/Observer/Collaboration 分支无业务 import。

---

## 6. Step 5｜Gateway 与 Host Readiness 解耦，先不造新 runtime registry

### 修改文件

- `packages/agent-gateway/src/process.ts`
- `packages/agent-gateway/tests/action-surface-worker-turn-alignment.test.ts`
- `packages/agent-gateway/tests/agent-gateway-critical-proofs.test.ts`
- `packages/agent-gateway/tests/agent-gateway-process.test.ts`
- `packages/platform-host/src/index.ts`
- `packages/platform-host/deployment/adapter.ts`
- `packages/platform-host/deployment/descriptor.ts`
- `spec/智能体运行与协作领域/04-模块/agent-gateway/TECHNICAL-DESIGN.md`
- `spec/智能体运行与协作领域/04-模块/agent-gateway/SERVICE-RUNTIME.md`
- `spec/平台架构与公共约定/05-平台模块/platform-host/TECHNICAL-DESIGN.md`
- `spec/平台架构与公共约定/05-平台模块/platform-host/SERVICE-RUNTIME.md`

### 必须改的行为

- Gateway 仍只做公网 Bearer→Role、transport/rate/error、generic route，不理解 Repomix/Local Dev/CodeGraph 业务。
- Gateway route 不因为 Host 的“所有依赖总体 READY”而拒绝本可执行的 Tool/Task/Peer；路由应依赖 Host liveness + operation 自己 readiness。
- Host 不再把旧 Execution Runtime + Model 当成 Local Tool/Task/Peer 的硬依赖；本机 Tool 依赖链改为 `execution-browser-extension bridge runtime → Extension Local Tool lane → execution-local Tool readiness`。
- `execution-browser-extension` bridge runtime 是 Local Tool 的必要基础设施，但不是 Execution Runtime；其 lifecycle/readiness 独立发布。Execution Runtime DOWN 时 bridge/Extension session/Local Tool lane 仍可 READY。
- Extension session DOWN 只影响需要 Extension 的 Tool/Browser operation；某个具体 Tool DOWN 不得使另外两个 Tool 或 Task/Peer DOWN。

### 关于 loopback HTTP

旧计划的“强制 0 个内部 HTTP + runtime-port registry”降级为**测量后优化项**。Local Tool 必须经过 Browser Extension，因此 Extension↔本机 local-tool bridge 的受控 loopback 是正式物理边界，不以“减少一次 HTTP”为理由绕开 Extension。只优化被 profiling 证明有问题的 transport，不新建复杂 registry/生命周期系统。

### Gate

Model runtime 模拟不可用时：Task read、Peer、Repomix/Local Dev/CodeGraph 仍按各自依赖工作。Execution runtime 模拟不可用时：direct Tools 仍工作；Browser/内部 Execution operation 返回自己的 unavailable。

---

## 7. Step 6｜Task / Node / Document 清洁化

### 修改/验证文件

- `packages/platform-host/src/index.ts`
- `packages/task-orchestration/src/contracts.ts`（仅真实需要时）
- `packages/task-orchestration/src/services.ts`（仅真实需要时）
- `packages/agent-gateway/tests/file-bridge-get-task-document.test.ts`
- `packages/platform-host/tests/platform-host-critical-proofs.test.ts`
- `packages/task-orchestration/tests/task-owned-integration.test.ts`

### 内容

- 删除 `getNodeContext` 返回中的 `executionCapabilityIds/executionCapabilityInputSchemas/executionRequestContext`。
- `getTask/getNodeContext` 继续提供完整 Task/Node/Document metadata，不附带工具执行协议。
- `getTaskDocument/putTaskDocument` 完全不依赖三 Tool Provider readiness。
- `putTaskDocument(openaiFileIdRefs)` 可继续通过内部 materialization 下载 bytes；这条内部链不变成 GPT Execution Action。
- 不把 `putTaskDocument` 改成 Local Dev 写文件。

### Gate

三 Provider 全部 disabled 时，Task/Node/Document/Peer 主链仍 PASS；Node context snapshot 中 Execution/Capability 字段 = 0。

---

## 8. Step 7｜Execution 边界收窄与死代码审计

### 主要文件

- `packages/execution-contracts/src/index.ts`
- `packages/execution-runtime/src/index.ts`
- `packages/execution-runtime/src/service.ts`
- `packages/execution-local/src/index.ts`
- `packages/platform-host/src/index.ts`
- `packages/execution-browser-extension/**` 中 Browser/WAKE/collaboration/materialization 使用点

### 实施规则

先用 CodeGraph 明确 `executeCapability/getExecution/readExecutionOutput` 的**内部调用者**与 GPT public caller。只删除 GPT surface、Host public branch、已经无 caller 的 schema/adapter；Browser WAKE、collaboration delivery、Approval/UNKNOWN、external-file materialization 等仍有内部 caller 的 durable core 保留。

`execution-local` 继续作为 Extension 后的本机工具实现扩展包，但不能把当前 Execution-shaped `createLocalExecutor()` 直接换名/薄包成 Direct Tool API。先把 fs/path/search/process/command/git 等可复用本机逻辑下沉为**不依赖 Execution DTO/lifecycle 的 primitives/provider ports**，再形成两个独立入口：

```text
execution-local primitives
├─ Direct Tool adapters: local-dev / repomix / codegraph
└─ internal execution-adapter: 仅 durable Execution caller 使用
```

Direct Tool adapter 不得 import `ExecuteCapabilityRequest/ExecutionRef/ExecutionRecord`，不得调用 `executeCapability()`，也不得复用 Execution queue/readiness/result envelope；internal execution-adapter 可以继续把同一 primitives 映射到 Browser/Approval/UNKNOWN/materialization 等内部 durable contract。旧 file/git/shell/process capability 不再作为 GPT-facing Capability；仅为旧 Execution wrapper 服务且无内部 caller 的 schema/adapter 在引用归零后删除。不得让 `execution-local` 反向依赖 Browser/Observer/Task/Agent 业务模块。

### Gate

- Agent packages/Gateway public operations/Host GPT route 中旧三 Execution Action = 0。
- 内部 Execution tests 继续证明 Browser/UNKNOWN/Approval/materialization 没被误删。
- 无“为了新工具又调用 executeCapability”的隐藏 bypass。

---

## 9. Step 8｜Task progression Reconciliation 后端化

### 修改/新增文件

- NEW `packages/platform-host/src/task-observer.ts`
- NEW `packages/platform-host/src/reconciliation-coordinator.ts`
- `packages/platform-host/src/index.ts`
- `packages/execution-browser-extension/extension/background.ts`
- `packages/execution-browser-extension/src/task-observer.ts`
- `packages/execution-browser-extension/src/observer-recovery-rearm.ts`
- `packages/execution-browser-extension/src/recovery-trigger.ts`
- NEW `packages/platform-host/tests/reconciliation-coordinator.test.ts`

### 内容

- Task Owner 继续是 workflow truth。
- deterministic Task Observer decision 可迁移/复用，但“什么时候再次扫描”由 backend bounded reconciliation 保证。
- kick/event 只加速；低频 catch-up 保证丢页面事件后最终发现 READY。
- per-task single-flight/backoff；System Observer reasoning 不占业务 progression 临界区。
- Browser Extension 的业务 progression 职责收窄为 Conversation/permission/submit/receipt/page reality；同时保留与 progression 完全隔离的 Local Tool Effect Gate。两条分支只共享最外层 Extension transport/identity primitive，不共享状态机或锁。
- Tools 成功/失败不自动 complete Node；Agent 自己调用 Task command。

### Gate

故意丢 `completeNode` 后页面事件、丢 reconnect hint、重启 Extension：Test READY 仍被系统重新发现并只形成一次正确 WAKE/delivery；UNKNOWN Browser effect 不盲重发。

---

## 10. Step 9｜Behavior / Fault / Throughput Gate

### 新增/重写测试

- `packages/platform-host/tests/tool-actions.test.ts`
- NEW `packages/platform-host/tests/tool-action-admission.test.ts`
- NEW `packages/platform-host/tests/direct-tool-readiness.test.ts`
- NEW `packages/platform-host/tests/dev-test-tool-journey.test.ts`
- `packages/platform-host/tests/execution-identity-admission.test.ts`：移除 GPT Execution expectations，只保留内部 Execution identity proof。
- `packages/platform-host/tests/cross-domain-composition-integration.test.ts`：必须变成运行时行为测试，static regex 只做结构守卫。
- 三 Role static/tool alignment tests。
- `packages/execution-browser-extension/tests/custom-gpt-provisioner.test.ts`
- `packages/platform-host/tests/reconciliation-coordinator.test.ts`

### 必测行为

1. Repomix pack→grep/read 的真实 handle 流程。
2. CodeGraph explore 返回结构关系。
3. Local Dev 批量 read；Dev 允许的 edit/write/command；Product 默认 mutation denied。
4. direct Tool request 不包含 Task/Node/Worker/Execution 字段。
5. simple Local Dev read 的 Task Owner query=0、Execution call=0。
6. Provider timeout/unavailable、mutation UNKNOWN、audit log failure。
7. Model/Execution unavailable 不污染 direct Tool/Task/Peer。
8. `putTaskDocument` 在 Tools 全禁时仍 PASS。
9. Dev complete→Test 自动接棒→Test 独立 Tool 验证→Task terminal。
10. Extension restart/lost trigger 后仍恢复 progression。
11. Custom GPT schema 真实 provisioning materialization 与仓库 schema 一致。

### 真实 Provider smoke

在 candidate 前，Repomix / Local Dev / CodeGraph 各做至少一次真实 API 调用；fake adapter 只能用于 fault injection，不能替代这三项 integration proof。

### 工程 Gate

```text
targeted tests
→ affected package typecheck/build
→ architecture + governance
→ behavior integration
→ pnpm check
```

吞吐先用确定性指标验收：一项 simple tool = 1 GPT Action、0 Task query、0 Execution call；同时记录 Gateway/Host overhead 与 Provider duration。没有 profiling 证据不得继续做第二轮网络微优化。

---

## 11. Step 10｜Frozen Candidate / Release

前置：Step 1～9 全 PASS。

### Candidate freeze

记录 source SHA、lock hash、changed package set、OpenAPI hash、Provider contract fixture hash、build artifact hash。

可能 changed packages：

```text
platform-host
agent-gateway
agent-product
agent-controller-dev
agent-test-ops
execution-browser-extension（schema provisioning / reconciliation 有 diff 时）
execution-contracts / execution-runtime / execution-local（仅真实 dead-code/boundary diff）
platform-cli / module-contract（仅 readiness/deployment contract 真有 diff）
```

只发布真实有 diff 的包；一次 hardening batch 一次 candidate，不按 seam 连续发布。

执行 package gate / publishability / Registry exact readback。publish 结果 UNKNOWN 先查 Registry/version/integrity，禁止重复 publish。

### Custom GPT schema adoption

Action schema 是本轮 breaking surface。Deployment 必须证明真实 GPT 已加载新 schema。

若当前 provisioning 不能对既有 GPT 原位更新 schema，只能显式 recreate + `saveCurrentRole` 切到新 g-id；此时旧 Conversation 不可能被假定自动获得新 Actions。**最终真实验证默认使用重部署后的新 Task/新 Worker Conversations。** 只有实际证明旧 GPT/Conversation 已原位采用新 schema，才允许把旧 SAME-SCENE 当额外兼容测试。

---

## 12. Step 11｜真实 Workspace 重新部署 + 真实人工视角验收

只按 `03-工作区重新部署手册.md` 执行，唯一正式 Workspace：

`/Users/agent/Desktop/proton-workspace`

部署完成后，在真实 Browser/Tunnel/GPT 上创建真实验证 Task：Product 完成 Requirement → Dev 接棒并用 Repomix/CodeGraph/Local Dev 调查与实现 → TaskDocument/complete → Test 自动接棒并独立工具验证 → complete → Task terminal。

旧 Task/Worker/Conversation 只做历史兼容证据，不作为新 Action schema 的强制前置；如果最终选择 `fresh:workspace`，更不能再要求旧 SAME-SCENE 保留。

Final Gate 中零源码 patch；出现产品缺陷记录 FIRST_DIVERGENCE，退出到对应 Step，修复后形成新 candidate 再部署。

---

## 13. 全程 STOP 条件

- Tool Provider 真实 transport 未证明就开始大规模 client 实现。
- Tool Action 重新带 Task/Node/Worker/Execution identity。
- Host 工具路由调用 Task Owner 或 Execution Runtime。
- `Capability` 换个名字重新成为 GPT-facing 中间抽象。
- TaskDocument 依赖 Local Dev。
- Model/Execution failure 仍全局挡住 Direct Tools。
- 为追求 0 loopback HTTP 引入复杂 runtime registry，且没有 profiling 证明收益。
- Provider mutation UNKNOWN 被自动重试。
- Custom GPT schema 只改文件、未证明真实 GPT adoption。
- Fake Provider/regex/static test 被算成最终 Behavior PASS。
- 一个 seam 一个 release/adoption round。

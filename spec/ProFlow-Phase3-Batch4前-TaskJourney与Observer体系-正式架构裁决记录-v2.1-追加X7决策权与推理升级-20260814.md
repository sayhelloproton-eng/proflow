# ProFlow Phase 3｜Batch4 前正式架构裁决记录 v2
## Task Journey / Custom GPT Carrier / Observer / File & Artifact / Recovery / Approval / OpenAI Reuse / OpenTeam Absorption

> 日期：2026-08-14  
> 状态：**正式讨论裁决记录 / Batch4 前文档更新输入**  
> 版本：v2  
> 适用范围：ProFlow Phase 3 第一版（v1）  
> 用途：在拿到最新仓库后，用于逐领域、逐模块、逐服务校正文档真源，并进一步约束 Batch4 的实现范围。  
> 重要说明：本文件不是“聊天摘要”，而是把 J0～J6、X1～X6 的讨论结果转写为**可审计的架构裁决、Owner 边界、不变量、主链、异常链、吸收/裁剪结果与后续落文档要求**。  
> 执行纪律：后续仓库文档更新必须“先读现状，再对照裁决做精准增量”；不得为了让代码看起来合理而反向修改本轮已冻结的业务事实和领域边界。

---

# 目录

1. 本轮架构重构的真正目标
2. v1 总体架构一句话
3. 核心术语与事实所有权
4. 全局不可违反的不变量
5. 三个固定泛化 Role 的最终模型
6. Identity 总模型
7. Task Journey 总图
8. J0｜Role Ready
9. J1｜New Task / 三 Worker 一次组队 / Product 需求沟通
10. J2｜用户确认 / Task Start
11. J3｜Node READY / RESTORE / WAKE
12. J4｜Worker Turn / Native GPT / Action / Execution / Collaboration
13. 跨 Worker Collaboration
14. J5｜Node Result / Next / WAIT / Reopen / Recovery
15. J6｜Terminal / Archive
16. X1｜Identity
17. X2｜File / Artifact / Evidence / Screenshot
18. X3｜Recovery / Idempotency / UNKNOWN
19. X4｜Logging / Trace
20. X5-A｜Task Observer
21. X5-B｜System Observer
22. System Observer 数据输入模型
23. System Observer 手机 REASON 分批与记忆设计
24. System Observer Drill-down / Global Synthesis
25. Task Observer 的 REASON 例外路径
26. X6｜Approval Channel
27. Extension Background 最终职责
28. Browser Carrier v1 最小能力
29. OpenAI 官方能力复用裁决
30. OpenTeam / 开源吸收裁决
31. GPT-facing Action Surface 裁剪原则
32. KEEP / REUSE / ABSORB / MERGE / REMOVE / DEFER 总矩阵
33. 关键负面约束（禁止重新引入）
34. 后续文档更新影响面
35. Batch4 实施边界
36. 关键测试 / Critical Proof 方向
37. 最终冻结式总结

---

# 1. 本轮架构重构的真正目标

本轮讨论不是给 ProFlow 再加一层“智能体编排系统”，而是在第一版准备收官前，把已经存在的 Task、Agent、Execution、Model、Deployment、Browser Extension、Gateway 与 Custom GPT 能力重新归位。

真正目标只有四个：

## 1.1 让 ProFlow 只拥有自己必须拥有的事实

ProFlow 必须长期拥有：

- Task / Node / workflow truth
- Role deployment / worker binding
- Collaboration durable message truth
- Execution real-effect truth
- Result / Evidence
- Approval safety fact
- Deployment readiness / human action requirement
- Structured diagnostic logs
- System-level derived assessment

ProFlow **不应该**重复拥有：

- GPT 内部 reasoning state
- GPT 内部 Code Interpreter session
- GPT Web Search runtime
- GPT Conversation 内部文件检索
- OpenAI permission workflow
- Browser frame topology
- Browser 自建“第二套 Task / Message / Execution 状态”

---

## 1.2 最大程度复用 ChatGPT 已经提供的认知能力

第一版要主动复用：

```text
Custom GPT Conversation
GPT Actions
Action Auth
File Bridge
Code Interpreter / Data Analysis
Web Search
Multi-action continuation
Always Allow
Conversation-native file usage
```

这意味着 ProFlow 不再为了“Agent 能工作”而复制一套：

```text
自建 Agent Runtime
自建 Tool Loop
自建公网 Research Agent
自建文件分析沙箱
自建动态 RAG
每 Action 再 Wake Browser
```

---

## 1.3 Browser Carrier 降到最薄

Browser 的职责不是“理解业务”，而是把一个长期 Worker Conversation 可靠地：

```text
创建
绑定
打开
恢复
WAKE
投递
观察
截图
恢复
```

Browser 不决定：

```text
Task 是否完成
Execution 是否成功
测试是否 PASS
该不该 reopen
该不该 approve
GPT 在想什么
```

---

## 1.4 用 Observer 替代“万能 Scheduler”

第一版需要两个 Observer，但两者职责完全不同：

```text
Task Observer
= 观察某一个 Task 是否出现确定的下一步推进条件

System Observer
= 评估整个 ProFlow 系统当前是否健康、哪里异常、哪里有风险、是否需要干预
```

Task Observer 默认 deterministic。

System Observer 才是“结构化系统数据 + 手机 REASON”的系统级评估器。

---

# 2. v1 总体架构一句话

> **ProFlow 第一版是“Task 事实驱动 + 三个长期 Custom GPT Worker + 薄 Browser Carrier + Owner Domain Actions + Execution real-effect plane + Collaboration durable communication + 手机 FAST/REASON/Vision + Task Observer / System Observer”的本地优先软件交付系统。**

不是：

```text
多 Agent 浏览器产品
Browser orchestration platform
frame runtime
agent simulation framework
workflow-RAG 平台
```

---

# 3. 核心术语与事实所有权

| 概念 | 含义 | Owner |
|---|---|---|
| packageName | 三个泛化逻辑岗位之一 | Agent Package / Deployment metadata |
| roleRef | 实际已部署 Custom GPT identity / g-id | Agent / Deployment |
| credential | GPT → Gateway 的认证 secret | Gateway/Auth + secure local config |
| workerRef | 某 Task 中具体 Role Worker 的稳定 identity | Task Worker Binding / Agent binding |
| conversation locator | 恢复 Worker Conversation 页面的地址/locator | Task binding / Carrier metadata |
| taskId | Task identity | Task |
| nodeId | 当前工作节点 identity | Task |
| runNo | 同一 Node 的第几轮执行 | Task |
| executionRef | 一次真实 Effect / Execution identity | Execution |
| messageRef | 一次正式 Collaboration message identity | Collaboration |
| artifactRef | materialized 工作产物 identity | Execution |
| evidenceRef | 证明 Execution Result 的 Evidence identity | Execution |
| correlationId | 跨组件 trace 关联 | Logging/transport |
| tabId | 当前 Chrome tab 临时地址 | Browser runtime only |
| operationRef | 当前技术操作 trace | Browser/Execution technical trace |
| assessmentRef | System Observer 派生评估 artifact identity | System Observer derived artifact |

---

# 4. 全局不可违反的不变量

以下不变量应直接进入后续领域文档、模块说明和测试计划。

## INV-01｜Business truth 永远由 Owner Domain 持有

Browser、Observer、日志、GPT Conversation 不得成为业务真源。

---

## INV-02｜Conversation 是 Worker 工作空间，不是 Task Store

Conversation 中“看起来已经完成”不等于 Node complete。

---

## INV-03｜真实 Effect 只能经过 Execution

无论是：

```text
shell
git
file write
network
browser submit
external delivery
```

只要涉及真实副作用，就应进入 Execution 的 real-effect / durable / result / evidence 语义。

---

## INV-04｜Browser 不根据自然语言推进 Task

禁止：

```text
抓 GPT 回复
→ NLP 判断“完成”
→ Browser complete Node
```

---

## INV-05｜Worker 与 tab 必须解耦

```text
workerRef / Conversation locator
= 稳定身份

tabId
= 临时运行时地址
```

Chrome 重启不应破坏 Task Worker identity。

---

## INV-06｜Reopen 复用原 Worker

```text
taskId 不变
nodeId 不变
workerRef 不变
Conversation 不变
runNo + 1
```

---

## INV-07｜UNKNOWN 禁止盲重放

任何可能已经产生 Effect 的操作，如果无法证明是否发生：

```text
→ UNKNOWN
→ observe current reality
→ 再决定
```

---

## INV-08｜Task Observer 默认不调用 REASON

规则能判定就绝不调用模型。

---

## INV-09｜System Observer 不是第二业务真源

它的 assessment 是派生判断，不能反向覆盖 Owner facts。

---

## INV-10｜Approval UI ≠ Approval Owner

Extension / Feishu 是 human interaction channel。

危险 Effect 的正式审批事实仍由 Execution 等真正 Owner 持有。

---

# 5. 三个固定泛化 Role 的最终模型

第一版固定：

```text
Product
Controller / Dev
Test / Ops
```

这三个 Role 已经足以覆盖第一版软件任务完整生命周期。

不新增：

```text
AI Product
Frontend Dev
Backend Dev
Cloud Engineer
Security Tester
Performance Tester
Advisor
Planner
Reviewer
```

未来专业化方式：

```text
Generic Role
+
Knowledge / Domain Material
=
Specialized behavior
```

但 Knowledge 不进入第一版实现。

## 裁决原因

1. 当前目标不是做“Agent Marketplace”。
2. 第一版最大风险是系统链路复杂，而不是 Role 不够细。
3. Role 过细会放大：
   - Deployment complexity
   - GPT credential 管理
   - Conversation binding
   - routing
   - Browser topology
   - testing matrix
4. 三角色已能覆盖：
   - 需求
   - 开发
   - 测试/运维
5. 未来专业化应优先通过 Knowledge，而不是扩 Role Type。

---

# 6. Identity 总模型

完整链：

```text
packageName
   ↓
逻辑岗位
   ↓
roleRef
   ↓
实际 Custom GPT
   ↓
credential
   ↓
GPT Action authentication


Task
   ↓
taskId
   ↓
packageName + roleRef
   ↓
workerRef
   ↓
Conversation locator
   ↓
Browser open / restore


Task Work
   ↓
nodeId + runNo

Cross-domain
   ↓
executionRef / messageRef / artifactRef / evidenceRef

Trace only
   ↓
correlationId / operationRef / attemptNo / tabId
```

## 明确不要再造

```text
RoleType
AgentType
PersonId
AgentInstanceId
SessionId
BrowserWorkerId
CarrierSessionId
FrameIdentity
PersistentTabIdentity
ConversationId + workerRef 双套长期身份
```

---

# 7. Task Journey 总图

```text
┌────────────────────────────────────────────────────────────┐
│ J0 Role Ready                                              │
│ 三个泛化 Custom GPT 已部署 / 注册 / 验证                   │
└────────────────────────────────────────────────────────────┘
                         ↓
┌────────────────────────────────────────────────────────────┐
│ J1 New Task                                                │
│ Extension 创建 PENDING Task                               │
│ 三角色新 Conversation / Worker 一次建立                    │
│ Product 立即开始需求沟通                                   │
└────────────────────────────────────────────────────────────┘
                         ↓
┌────────────────────────────────────────────────────────────┐
│ J2 User Confirm / Start                                    │
│ Extension UI → Task start                                  │
│ Task 校验 readiness → first Node READY                     │
└────────────────────────────────────────────────────────────┘
                         ↓
┌────────────────────────────────────────────────────────────┐
│ J3 Worker Locate / Restore / Wake                          │
│ Task Observer → Carrier → correct Conversation             │
│ minimal WAKE physically delivered                         │
└────────────────────────────────────────────────────────────┘
                         ↓
┌────────────────────────────────────────────────────────────┐
│ J4 Worker Turn                                             │
│ GPT native capability + Actions + Execution + Collaboration│
└────────────────────────────────────────────────────────────┘
                         ↓
┌────────────────────────────────────────────────────────────┐
│ J5 Result / Next / Wait / Reopen / Recovery                │
│ Owner facts change → Task Observer → next Wake             │
└────────────────────────────────────────────────────────────┘
                         ↓
┌────────────────────────────────────────────────────────────┐
│ J6 Terminal / Archive                                      │
│ Task Observer stops driving                                │
│ bindings / conversation / evidence retained                │
└────────────────────────────────────────────────────────────┘
```

---

# 8. J0｜Role Ready

## 8.1 业务目标

保证平台在创建任何 Task 之前，三个 Role 已经具备“可用于真实任务”的能力。

---

## 8.2 输入

```text
Agent Package
Deployment descriptor
GPT Instructions
Action OpenAPI
Gateway endpoint
roleRef
credentialRef
required GPT capabilities
```

---

## 8.3 成功输出

对每个 packageName：

```text
registered roleRef
credential binding exists
Action endpoint verified
required behavior/capability verified
role readiness = READY
```

---

## 8.4 Owner

- Agent Package：定义 Role
- Deployment：安装、配置、验证
- chatgpt-carrier adapter：验证真实 GPT / Web-only facts
- Gateway：认证绑定
- Browser：不参与 J0 Task/Worker identity

---

## 8.5 Role READY 不能绑定精确模型 ID

不允许：

```text
modelId == 某固定字符串
→ READY
```

应看行为能力：

```text
Actions 可用
Auth 可用
Code Interpreter / Web Search / File Bridge 要求满足
Gateway 可达
required behavior proof 通过
```

模型 ID 只做 hint。

---

## 8.6 Web-only 是正式事实

GPT create/edit 仍然属于：

```text
ACTION_REQUIRED_WEB
```

第一版不强行做 GPT Builder automation。

---

## 8.7 不需要 Role Readiness Runtime

J0 不引入：

```text
RoleReadinessService
RoleCapabilityRegistry
PersonaRuntime
AgentRuntimeProcess
```

Deployment verify 已经是合适 Owner。

---

# 9. J1｜New Task / 三 Worker 一次组队 / Product 需求沟通

## 9.1 入口

Extension 是唯一 New Task 入口。

UI：

```text
Task List
New Task
```

---

## 9.2 先创建 Task，再创建 Worker

顺序必须是：

```text
New Task
→ Task(PENDING)
→ taskId
→ 三 Worker creation/binding
```

原因：Worker 必须从一开始绑定明确 taskId，不能先产生无主 Conversation 再猜属于谁。

---

## 9.3 三 Worker 一次建立

固定 mapping：

```text
Product packageName
→ Product roleRef
→ new Product Conversation
→ Product workerRef

Controller/Dev packageName
→ Dev roleRef
→ new Dev Conversation
→ Dev workerRef

Test/Ops packageName
→ Test roleRef
→ new Test Conversation
→ Test workerRef
```

---

## 9.4 Product 可以先工作

三 Worker 创建可以并发，但：

```text
Product 绑定成功
→ 立即进入需求沟通

Dev / Test
→ 完成 bind
→ remain IDLE
```

不需要 Product 等另外两个全部成功才开始和用户聊需求。

---

## 9.5 新 Conversation 最小初始化

如果 ChatGPT 新 Conversation 必须发送第一条消息后才出现稳定 c-id：

### Product

可发送最小 requirement-start 初始化。

### Dev / Test

只发送最小：

```text
WORKER_BIND
taskId
workerRef
bind-only
remain waiting
```

禁止注入：

```text
完整 Requirement
代码包
大 Context
测试上下文
```

---

## 9.6 Partial success

必须局部恢复：

```text
已成功绑定的 Worker 保留
只补缺失 Worker
```

不能因为第三个失败而重建前两个。

---

## 9.7 Task readiness

Task 正式 Start 前至少具备：

```text
Product Worker bound
Dev Worker bound
Test Worker bound
Requirement formally available
Task current state legal
```

Browser tab alive 不是 readiness。

---

## 9.8 删除 Product createTask 主链

Product GPT 不再：

```text
createTask()
listRegisteredRoles()
dynamic select Dev/Test
```

因为 Extension 已经完成这些确定性工作。

---

# 10. J2｜用户确认 / Task Start

## 10.1 用户交互

v1：

```text
Extension Dialog
“批准并开始”
```

future：

```text
Feishu
```

---

## 10.2 Task 不拥有审批流程

Task 不建立：

```text
Approval Entity
ApprovalRecord
APPROVAL_PENDING
Approval Workflow
```

Task 只收到合法 start command。

---

## 10.3 start 时重新校验

必须 re-read current reality：

```text
Task still PENDING/eligible?
Requirement ready?
3 Worker bindings complete?
expectedVersion correct?
idempotency key new or duplicate?
```

---

## 10.4 成功结果

```text
Task enters legal start state
first business Node READY
```

Task 不直接 Browser wake。

---

# 11. J3｜Node READY / RESTORE / WAKE

## 11.1 触发源

Task Observer 观察到：

```text
current Node READY
+
requiredRole binding exists
+
当前 run 未成功 WAKE
```

---

## 11.2 读取 Binding

得到：

```text
taskId
nodeId
runNo
packageName
roleRef
workerRef
conversation locator
```

---

## 11.3 Carrier 恢复策略

```text
已有正确 Conversation tab
→ focus/reuse

没有
→ open conversation locator

打开后
→ 等待 page ready

验证
→ 当前 Conversation identity 与 expected workerRef / c-id 一致
```

不做 frame handshake。

---

## 11.4 WAKE payload

最小：

```text
taskId
nodeId
runNo
workerRef
trigger
```

trigger 可能是：

```text
NODE_READY
EXECUTION_RESULT_READY
PEER_REPLY_READY
REOPEN
RECOVERY_RESUME
```

---

## 11.5 J3 的成功定义

只认物理投递成功：

```text
message submitted
+
current correct Conversation
+
可确认本次 wake 已存在
```

不认：

```text
GPT 页面有新文字
GPT 开始 thinking
GPT 说“收到”
```

---

## 11.6 提交后的不确定性

如果 submit 后 Extension 断开：

```text
reopen same Conversation
→ observe wake exists?
```

结果：

```text
YES → DELIVERED
NO  → retry allowed
UNKNOWN → no blind replay
```

---

# 12. J4｜Worker Turn / Native GPT / Action / Execution / Collaboration

## 12.1 Worker Turn 定义

Worker Turn 是运行语义，不是实体：

```text
一次 wake/input
→ GPT 可能连续多轮内部推理
→ 0..N Actions
→ native tools
→ Action Results
→ 最终 formal action / wait / reply
```

---

## 12.2 工具选择总原则

### 情况 A：只是需要更多知识

优先：

```text
Conversation memory
File Search
Code Interpreter
Web Search
```

### 情况 B：读取/修改 ProFlow 正式事实

使用：

```text
GPT Actions
→ Gateway
→ Owner Domain
```

### 情况 C：真实机器 / 外部 Effect

使用：

```text
Execution
```

---

## 12.3 Browser 在 J4 退出主链

正常情况下，Browser 完成 J3 后就不继续“盯着 GPT”。

不需要：

```text
抓每一条 GPT 回复
自动点每一个 Action
每 Action 后发送继续
```

---

## 12.4 getNodeContext

不是 ritual。

需要 fresh formal state 时调用。

Owner expectedVersion/current-state check 才是写安全核心。

---

## 12.5 File Bridge

### GPT → ProFlow

```text
openaiFileIdRefs
→ Gateway
→ Execution materialize
→ artifactRef
```

### ProFlow → GPT

```text
artifact/document
→ openaiFileResponse
→ Conversation
```

---

## 12.6 Code Interpreter

用于：

```text
多文件分析
日志分析
数据分析
patch 生成
报告生成
```

但真实 repo 修改仍由 Execution。

---

## 12.7 Web Search

用于公开 research。

Execution Network 继续负责：

```text
private
local
credentialed
exact deterministic HTTP
download
probe
evidence
```

---

## 12.8 Context Pack

Context Pack 是 Execution Artifact subtype，不是新服务。

构造原则：

```text
bounded
node-scoped
relevant only
secret excluded
binary filtered
size bounded
manifest/hash included
```

---

## 12.9 Patch

Patch 是 proposal artifact：

```text
GPT
→ patch artifact
→ Execution validate
→ apply
→ test
→ evidence
```

GPT 不直接拥有 repo truth。

---

# 13. 跨 Worker Collaboration

## 13.1 askPeer / replyPeer 的 Owner

正式进入：

```text
Collaboration Message Center
```

不进入 Task Store。

---

## 13.2 Message 的 Task 字段只是 correlation

可以带：

```text
taskId
nodeId
runNo
sourceWorkerRef
targetWorkerRef
```

但这不让 Message 变 Task fact。

---

## 13.3 跨 Worker 必然有 wake boundary

```text
source askPeer
→ durable message
→ target Task/Collaboration observer path
→ Carrier wake target
→ target Worker Turn
→ replyPeer
→ durable reply
→ wake source
```

---

## 13.4 不做动态组队

固定三 Worker 后：

```text
packageName
→ bound workerRef
```

直接路由。

不做：

```text
agent discovery
capability matching
advisor routing
team topology
```

---

# 14. J5｜Node Result / Next / WAIT / Reopen / Recovery

## 14.1 Node complete

```text
Worker formal Task action
→ Task validates actor/context/version/runNo
→ node complete
→ next node READY
```

Task Observer 再驱动下一 Worker。

---

## 14.2 WAIT 分层

### Execution pending

Owner = Execution

### Peer pending

Owner = Collaboration

### Approval pending

Owner = Execution / relevant owner

### 真正业务 workflow blocked

Owner = Task

原则：

> 不要为了“现在暂时没结果”就创建 Task WAIT Node。

---

## 14.3 Reopen

业务语义：

```text
上一次工作结果不满足，需要重新做
```

Task：

```text
same nodeId
same workerRef
same Conversation
runNo + 1
downstream reset per frozen rules
```

---

## 14.4 Recovery

技术语义：

```text
业务事实没有变化
只是 transport / browser / execution observation / delivery 失败
```

Recovery 不改变 Task business state。

---

# 15. J6｜Terminal / Archive

## 15.1 Terminal

只能由 Task formal transition 产生。

---

## 15.2 Task Observer stop-driving guard

```text
if task is terminal:
    do not emit business wake/resume
```

---

## 15.3 保留 Worker Binding

历史保留：

```text
packageName
roleRef
workerRef
conversation locator
```

---

## 15.4 tab 不属于 archive

用户可继续打开历史 Conversation，但 tab lifecycle 不由 Task 管。

---

## 15.5 dangling facts

System Observer 可以发现：

```text
terminal task
+
dangling execution
pending collaboration
missing evidence
archive inconsistency
```

但只能形成 finding，不自动重新激活 Task。

---

# 16. X1｜Identity

最终保留：

```text
packageName
roleRef
credential
taskId
nodeId
runNo
workerRef
conversation locator
executionRef
messageRef
artifactRef
evidenceRef
correlationId
```

技术临时：

```text
tabId
operationRef
attemptNo
```

---

# 17. X2｜File / Artifact / Evidence / Screenshot

## 17.1 六类核心对象

```text
Conversation File
Task Document
Execution Artifact
Evidence
Context Pack / Patch
Screenshot
```

---

## 17.2 Conversation File

仅表示 GPT Conversation 当前可使用文件。

不是正式平台事实。

---

## 17.3 Task Document

Task owns：

```text
logical document relation
type
input/output
task/node association
document ref
```

不必拥有独立 blob store。

---

## 17.4 Execution Artifact

Execution owns：

```text
materialization
path
hash
mime
size
download/upload boundary
validation
```

---

## 17.5 Evidence

Evidence 用于证明：

```text
Result
Delivery
Effect
```

Artifact 与 Evidence 可引用同一个 bytes，但语义不能合并。

---

## 17.6 Screenshot

### Carrier screenshot

目的：

```text
ChatGPT page recovery / DOM ambiguity
```

### Business browser screenshot

目的：

```text
Execution business evidence / Vision
```

两者不能混为“普通 File Bridge 文件传输”。

---

# 18. X3｜Recovery / Idempotency / UNKNOWN

## 18.1 统一 Effect 判定表

| 状态 | 是否可以 retry |
|---|---|
| read-only failed | 是 |
| effect-before-execution failed | 是 |
| effect confirmed absent | 是 |
| effect confirmed success | 否，复用结果 |
| effect uncertain | 否，先 observe |
| effect UNKNOWN after observation | 否，人工/诊断/进一步 evidence |

---

## 18.2 Create Worker

不能断线后直接再创建。

必须先查：

```text
是否已有该 Task + packageName 的 Conversation binding
```

---

## 18.3 WAKE

不能 submit 后断线就重发。

先观察同一 Conversation。

---

## 18.4 Collaboration Delivery

同一个 messageRef 的 physical delivery 必须 exactly-once / idempotent。

---

## 18.5 Execution

继续复用：

```text
durable execution record
approval
result
evidence
unknown
recovery
```

Browser 不再造第二个 durable effect plane。

---

# 19. X4｜Logging / Trace

## 19.1 Business Fact / Evidence / Log 三分

```text
Business Fact
= Owner state truth

Evidence
= proof

Log
= diagnostic trail
```

永远不能混。

---

## 19.2 Log correlation axes

```text
taskId
nodeId
runNo
packageName
roleRef
workerRef
executionRef
messageRef
artifactRef
correlationId
```

---

## 19.3 Browser-specific

```text
operationRef
attemptNo
tabId
```

仅 diagnostic。

---

## 19.4 不记录 secret / 内容正文

禁止：

```text
raw credential
Authorization
full prompt
full reply
full file
screenshot binary
provider secret
```

---

# 20. X5-A｜Task Observer

## 20.1 本质

Task Observer 是**确定性的 Task progression detector**。

它不是 AI planner。

---

## 20.2 输入

至少：

```text
Task state
current Node state
runNo
required packageName
Worker binding
last wake/delivery state
relevant Execution result readiness
relevant Collaboration reply readiness
reopen state
terminal state
```

---

## 20.3 输出

只发 typed request：

```text
WAKE_WORKER
RESUME_WORKER
DELIVER_PEER_REPLY
RECOVER_WORKER_PAGE
```

实际命令名称以现有合同为准，不要求重新命名。

---

## 20.4 不允许

```text
直接 completeNode
直接 reopenNode
直接 approve
直接修改 Execution
直接写 Collaboration truth
```

---

# 21. X5-B｜System Observer

## 21.1 本质

System Observer 是：

> **整个系统的低优先级评估器，而不是全局待办处理器。**

它回答：

```text
系统整体健康吗？
哪里异常？
哪里风险在积累？
哪里出现趋势性退化？
哪些 Task/Execution/Carrier/Deployment 状态相互关联？
是否需要进一步诊断？
是否需要人工干预？
```

---

## 21.2 System Observer = 结构化数据 + 手机 REASON

不是：

```text
if/else 聚合器
纯 dashboard
log watcher
万能 scheduler
```

---

## 21.3 它仍然不拥有业务事实

System Observer 只能：

```text
read
assess
find
recommend
request
```

不能：

```text
approve
complete
reopen
mark delivered
declare deployment READY
rewrite execution result
```

---

# 22. System Observer 数据输入模型

必须先构造 bounded views，而不是把数据库 dump 给模型。

## 22.1 Task View

字段建议围绕：

```text
taskId
task status
current nodeId
node status
runNo
required packageName
stalled duration
last transition at
last successful wake at
blocker summary
terminal integrity summary
```

不默认包含 Requirement 全文。

---

## 22.2 Agent / Worker View

```text
packageName
roleRef
workerRef
binding status
conversation locator health
last wake result
last observed carrier status
identity mismatch flags
```

不含 raw credential。

---

## 22.3 Collaboration View

```text
messageRef
source/target worker
status
pending duration
delivery attempts
reply state
task correlation
error summary
```

不默认包含全文消息。

---

## 22.4 Execution View

```text
executionRef
capability
status
queued duration
running duration
waiting approval duration
unknown duration
result summary
errorCode
evidence refs
retry/recovery count
```

---

## 22.5 Carrier View

```text
open/restore health
wake success/failure rate
delivery unknown count
DOM selector failure trend
login/auth anomalies
Vision fallback count
recovery retry distribution
```

---

## 22.6 Model View

```text
runtime reachable
FAST available
REASON available
active model
busy state
latency summary
error summary
recent failure trend
server_paused / model_busy
```

---

## 22.7 Deployment / Service View

```text
module status
external resource status
READY / DEGRADED / ACTION_REQUIRED
verification freshness
doctor finding summary
service health
```

---

## 22.8 Log / Artifact / Evidence View

默认只输入摘要：

```text
critical error aggregation
errorCode top N
recent repeated failures
artifact metadata
evidence completeness
test summary
changed-files summary
```

不输入所有原始日志。

---

# 23. System Observer 手机 REASON 分批与记忆设计

这是后续必须认真验证的关键。

## 23.1 为什么不一次塞全部

即使模型支持大 Context，也存在：

```text
token 能容纳
≠
4B REASON 在极大上下文下仍有可靠全局推理能力
```

因此不能把“理论 context window”当成“系统评估有效负载”。

---

## 23.2 第一层：Deterministic Snapshot

各 Owner 先输出 bounded projection。

该层不调用 REASON。

目标：

```text
压缩
规范字段
去 secret
去全文
去重复
保留 identity
保留时间
保留状态
保留 error/evidence refs
```

---

## 23.3 第二层：Concern Batches

建议第一版默认至少四批：

### Batch A｜Task + Worker

关注：

```text
workflow stuck
worker binding
wake/resume
reopen
terminal integrity
```

### Batch B｜Execution + Approval

关注：

```text
queue
running
unknown
approval backlog
failure/recovery
evidence
```

### Batch C｜Collaboration + Carrier

关注：

```text
message backlog
delivery
worker restore
DOM drift
wake failure
```

### Batch D｜Model + Deployment + Health

关注：

```text
model runtime
FAST/REASON health
service readiness
deployment degradation
external resources
global error aggregates
```

必要时再细分，不要求永远固定 4 批。

---

## 23.4 每批统一输出 Contract

概念上：

```json
{
  "scope": "...",
  "observedAt": "...",
  "health": "HEALTHY|DEGRADED|CRITICAL|UNKNOWN",
  "findings": [],
  "risks": [],
  "anomalies": [],
  "hypotheses": [],
  "unresolved": [],
  "needsDrilldown": [],
  "evidenceRefs": [],
  "confidence": 0.0,
  "carryForward": []
}
```

不要求现在冻结字段名，但语义必须存在。

---

## 23.5 显式记忆，而不是依赖模型会话

不依赖：

```text
MLXHub server-side history
某个长期 REASON Conversation
```

而是保存派生 Assessment Artifact。

下一轮输入：

```text
Current Snapshot
+
Previous unresolved findings
+
Previous carryForward
+
Resolved/changed facts
```

---

## 23.6 carry-forward 的目的

不是把历史全文传回来。

而是保留：

```text
尚未解决的 hypothesis
持续风险
需要追踪的 executionRef/taskId
上轮 confidence
上轮需要 drill-down 的点
```

---

# 24. System Observer Drill-down / Global Synthesis

## 24.1 Broad-first

第一轮先广度：

```text
全系统 compact snapshot
```

---

## 24.2 Drill-down

如果发现：

```text
Execution UNKNOWN rate ↑
```

下一轮只拉：

```text
UNKNOWN executions
recent transitions
error summaries
relevant evidence metadata
carrier/network correlations
```

---

## 24.3 Global Synthesis

最终 synthesis 输入：

```text
Top-level current snapshot
+
Batch A assessment
+
Batch B assessment
+
Batch C assessment
+
Batch D assessment
+
Previous unresolved findings
+
Drill-down results
```

目标不是“拼 summary”，而是寻找跨域因果：

```text
Task stalled
+
Carrier wake failures
+
DOM selector errors spike
→ probable carrier UI drift
```

或：

```text
多个 Task stalled
+
REASON unavailable
+
model_busy repeated
→ model capacity / availability degradation
```

---

## 24.4 System Assessment 最终输出

至少语义包含：

```text
overall health
critical findings
major risks
systemic anomalies
cross-domain causal hypotheses
resolved findings
persistent findings
new findings
recommended actions
needs human attention
needs drilldown
confidence
```

---

## 24.5 优先级

System Observer 永远最低。

```text
用户实时动作
>
Carrier 当前任务
>
Task Observer
>
async resume/delivery
>
System Observer
```

如果手机模型忙：

```text
defer
```

下一轮重新读取 reality。

---

# 25. Task Observer 的 REASON 例外路径

Task Observer 主链不使用模型，但允许极少数单 Task 诊断旁路。

## 25.1 允许触发的典型情况

### A. 多源事实冲突

```text
Node IN_PROGRESS
Execution UNKNOWN
last wake uncertain
worker no action
```

### B. 连续 recovery 失败

```text
restore failed N times
DOM fallback failed
Vision result ambiguous
```

### C. Task stalled 无单一 blocker

Owner facts 都“看起来没问题”，但 Task 长期无进展。

### D. 多个异常需要排序

```text
peer reply pending
execution warning
carrier stale
```

需要判断先看哪个。

---

## 25.2 REASON 只能给诊断

输出：

```text
finding
probableCause
confidence
recommendedNextObservation
recommendedRecoveryAction
needsHumanAttention
```

---

## 25.3 不允许模型直接驱动 workflow

禁止：

```text
REASON → completeNode
REASON → reopenNode
REASON → approve
REASON → retry dangerous effect
```

---

## 25.4 Task vs System 分流

```text
单 Task / 单 run / 局部异常
→ Task Diagnostic Assessment

多个 Task / 系统趋势 / 跨服务
→ System Observer
```

---

# 26. X6｜Approval Channel

四类必须分开。

## 26.1 Task start confirmation

不是正式 Approval Domain。

```text
Extension / Feishu
→ user confirms
→ Task start command
```

---

## 26.2 Execution safety approval

正式安全事实由 Execution 持有：

```text
executionRef
effect fingerprint
scope
actor
status
expiry
```

Extension / Feishu 只是 channel。

---

## 26.3 Deployment human action

```text
ACTION_REQUIRED
ACTION_REQUIRED_WEB
```

不是 approve。

必须等待真实 human action 完成，再 re-observe。

---

## 26.4 ChatGPT Action Permission

Routine Actions：

```text
x-openai-isConsequential:false
+
Always Allow
```

从正常业务主链移除。

Unexpected permission prompt = carrier recovery / user interaction。

---

# 27. Extension Background 最终职责

第一版 Extension 可在同一 package 内包含五个逻辑块：

```text
Task UI
Approval / Alert UI
Task Observer
System Observer
Background Carrier Controller
```

不要拆成五个新 Domain。

---

# 28. Browser Carrier v1 最小能力

KEEP：

```text
create/open Conversation page
observe c-id / locator
reuse/focus tab
reopen locator
wait page ready
scroll bottom
locate input
programmatic input
submit
observe delivery
screenshot
Vision fallback
bounded retry
unknown handling
structured result
```

REMOVE：

```text
frame registry
frame handshake
iframe workspace
persistent tab store
dynamic agent topology
browser business message store
browser orchestration store
DOM business result parsing
browser file manager
mouse coordinate automation
keyboard coordinate automation
```

---

# 29. OpenAI 官方能力复用裁决

## REUSE-01｜Custom GPT Conversation

作为长期 Worker 工作上下文。

---

## REUSE-02｜GPT Actions + Action Auth

作为 GPT → ProFlow 正式能力入口。

---

## REUSE-03｜Always Allow

Routine Actions 不再每次人工允许。

---

## REUSE-04｜File Bridge

用于 GPT ↔ ProFlow 文件运输。

---

## REUSE-05｜Code Interpreter

用于 GPT 内部文件 / 代码 / 数据分析和产出。

---

## REUSE-06｜Web Search

用于公开互联网 research。

---

## REUSE-07｜Multi-action continuation

一个 Worker Turn 内连续调用多个 Action。

---

## CONSTRAINT-01｜Actions 不提供任意 Custom Headers

业务 identity 必须 typed body/path/query。

---

## CONSTRAINT-02｜Actions 不暴露稳定 Conversation c-id

Conversation identity 继续由 Browser observe / bind。

---

## CONSTRAINT-03｜File Bridge image asymmetry

平台截图 → GPT 不依赖普通 file response，继续保留 Vision 路径。

---

## CONSTRAINT-04｜GPT Builder Web-only

Deployment 保留 ACTION_REQUIRED_WEB。

---

# 30. OpenTeam / 开源吸收裁决

只吸收机制，不搬产品模型。

## ABSORB

```text
Background Controller pattern
typed UI→background command
Conversation URL/c-id observation
page-level restore
bounded attempt/retry
structured carrier operation result
current-reality observation
```

## REJECT

```text
frame architecture
iframe team workspace
browser team topology
dynamic advisor/persona
OpenTeam business message store
OpenTeam orchestration store
DOM reply as business truth
```

---

# 31. GPT-facing Action Surface 裁剪原则

第一版 GPT-facing Actions 应围绕“业务目的”而不是“底层系统调用”。

优先：

```text
Task context / transition
Collaboration ask/reply
Execution request / get result
Artifact / File Bridge
```

谨慎或降级：

```text
read_file
write_file
run_command
git operation
browser primitives
generic http
```

这些底层 primitive 可继续存在于 Execution 内部 / typed capability，但不应全部成为 GPT 高频一等入口。

---

# 32. KEEP / REUSE / ABSORB / MERGE / REMOVE / DEFER 总矩阵

## KEEP

```text
Task formal truth
Node/runNo
3 fixed Agent Packages
roleRef
credential per role
workerRef
conversation locator
Collaboration Message Center
Execution durable effects
Result/Evidence
Artifact
Execution approval
Gateway auth/routing
Task Observer
System Observer
FAST/REASON/Vision
structured logs
Deployment verify/doctor
```

## REUSE

```text
Custom GPT
Conversation
Actions
Action Auth
Always Allow
File Bridge
Code Interpreter
Web Search
Multi-action
Conversation file use
```

## ABSORB

```text
Background Controller
typed commands
c-id / URL observation
page-level recovery
bounded retry
structured carrier results
```

## MERGE / SIMPLIFY

```text
RoleType → packageName
Role readiness → Deployment verify
capability profile → Agent Package metadata
Product task entry → Extension New Task
worker creation → New Task one-time teaming
Context Pack → Artifact subtype
Patch → Artifact subtype
Task document bytes → artifact reference where applicable
async resume → Task Observer
```

## REMOVE / REDUCE

```text
specialized Role v1
Knowledge v1
dynamic agent discovery
Product createTask main path
listRegisteredRoles main path
frame/frame registry/handshake
persistent tab identity
browser business store
browser file manager
browser large context injection
browser natural-language task progression
Action-level wake scheduler
WorkerTurn entity/runtime
dynamic Task RAG
Gateway file store
Agent artifact store
ContextPack service
Patch service
File Transfer domain
Blob service
Archive service
second browser effect runtime
complex recovery graph
Task Observer default REASON
System Observer as scheduler
exact model pin
GPT custom-header identity
```

## DEFER

```text
Knowledge specialization
Feishu integration
GPT Builder automation
advanced System Observer adaptive strategies
real external E2E until final manual phase
```

---

# 33. 关键负面约束（禁止重新引入）

后续文档 / 代码审计如果重新出现以下设计，应视为明显 architecture drift：

```text
Frame Registry
Frame-role handshake
Iframe team workspace
Dynamic role discovery in main flow
Browser deciding Task success from GPT text
Browser moving ordinary files via DOM
Task approval workflow/entity for simple start confirmation
System Observer owning Task/Execution facts
Task Observer invoking REASON for normal READY/RESULT/REPLY
New Worker on every reopen
New Conversation on every run
Execution pending → forced Task WAIT node
Peer pending → forced Task WAIT node
Log recovery as business truth
Conversation used as formal archive truth
Exact ChatGPT model id as Role READY
credential == packageName
```

---

# 34. 后续文档更新影响面

拿到最新仓库后，不直接改代码。先逐类文档审计。

## 34.1 Task & Orchestration

检查并更新：

```text
Task creation ownership
Worker binding timing
Task readiness
Task start
Node READY
complete
wait
reopen
runNo
terminal
Task Observer
```

重点清除：

```text
Product createTask main flow
Task approval entity for start
all async waits forced into Task
```

---

## 34.2 Agent Runtime & Collaboration

更新：

```text
3 generic Roles
packageName/roleRef/credential
Worker = Conversation
Task-scoped binding
askPeer/replyPeer
fixed routing
async cross-worker wake
```

裁：

```text
dynamic role discovery
persona routing
agent matching
```

---

## 34.3 Gateway

更新：

```text
3-role auth
authenticatedRoleRef
typed body identity
no custom business headers
File Bridge
thin routing
```

明确：

```text
Gateway not file owner
not execution owner
not task owner
not tool router AI
```

---

## 34.4 Execution

更新：

```text
browser effects
delivery durability
unknown
file materialization
artifact/evidence
context pack
patch
approval
network boundary
```

---

## 34.5 Browser Extension

重点：

```text
Task UI
New Task
3 Worker creation
Conversation binding
Task Observer
System Observer
Approval UI
Background Carrier Controller
page-level restore
DOM-first submit
Vision fallback
```

删除：

```text
frame topology
browser file manager
business orchestration logic
```

---

## 34.6 Model & Reasoning

重点新增 / 对齐：

```text
Task diagnostic REASON
System Observer REASON
bounded snapshot
batch assessment
carry-forward
drill-down
global synthesis
context budget
real REASON load testing
Vision fallback
```

---

## 34.7 Deployment

更新：

```text
Role capability requirements
File Bridge
Code Interpreter
Web Search
Always Allow
Action Auth
Web-only GPT configuration
behavior readiness
```

---

## 34.8 Agent Packages

更新 Instructions：

```text
native GPT capability first
business Action boundary
Execution boundary
Collaboration boundary
File Bridge
Code Interpreter
Web Search
no specialized Knowledge v1
```

---

## 34.9 Test Plan / Critical Proof

至少覆盖：

```text
3 Worker partial bind recovery
Conversation restore
wake exactly-once
wake unknown
multi-action no extra wake
file bridge
artifact materialization
context pack
patch apply
peer async return
reopen same worker
terminal no ghost wake
Task Observer deterministic
Task Diagnostic REASON no authority
System Observer batch/carry-forward/drill-down
approval ownership/channel separation
secret redaction
```

---

# 35. Batch4 实施边界

Batch4 才进入代码，目标不是“再开发一个新系统”，而是：

```text
OpenAI native reuse alignment
+
OpenTeam clean-room Carrier absorption
+
Extension Task/System Observer
+
existing complexity removal
+
Task/Agent/Execution/Model/Deployment cross-domain alignment
+
final non-E2E closure
```

不进入：

```text
Knowledge
Feishu
GPT Builder full automation
real final E2E
```

---

# 36. 关键测试 / Critical Proof 方向

## CP-A｜Worker Binding

```text
3 roles
new conversations
c-id observed
partial failure recovery
no duplicate worker
```

## CP-B｜Wake

```text
correct Conversation
exactly once
disconnect after submit
re-observe
unknown no replay
```

## CP-C｜Worker Turn

```text
one wake
multiple sequential Actions
no browser continue spam
```

## CP-D｜Collaboration

```text
askPeer durable
target wake
reply durable
source wake
no Task state mutation
```

## CP-E｜Reopen

```text
same workerRef
same Conversation
runNo + 1
```

## CP-F｜File Bridge / Artifact

```text
inbound file
Execution materialization
hash/mime/size
artifact ref
outbound file
```

## CP-G｜System Observer

```text
bounded views
batching
carry-forward
cross-domain synthesis
drill-down
no business write authority
```

## CP-H｜Approval

```text
Task start confirmation channel
Execution approval fact
Deployment ACTION_REQUIRED
ChatGPT Always Allow
互不混淆
```

---

# 37. 最终冻结式总结

第一版 ProFlow 最终应呈现为：

```text
用户
↓
Extension Task UI
↓
Task
↓
Task Observer
↓
Browser Carrier
↓
固定三角色 Worker Conversation
↓
GPT Native + Actions
↓
Gateway
↓
Task / Collaboration / Execution
↓
Execution Result / Evidence
↓
Task Observer 再驱动
```

旁路：

```text
System Observer
↓
全系统 bounded snapshots
↓
手机 REASON 分域评估
↓
carry-forward / drill-down
↓
global synthesis
↓
assessment/findings/recommendations
```

真实 Effect：

```text
永远由 Execution
```

正式工作流：

```text
永远由 Task
```

正式沟通：

```text
永远由 Collaboration
```

页面恢复：

```text
永远由 Browser Carrier
```

系统级思考：

```text
System Observer + REASON
```

Task 正常推进：

```text
Task Observer deterministic
```

本轮最大架构收益不是“增加了多少能力”，而是：

> **把 Custom GPT 已经擅长的能力还给 Custom GPT，把 Browser 降成可靠 Carrier，把 Task / Execution / Collaboration 的 Owner 边界重新拉直，把 Observer 分成“确定性推进观察”和“系统级智能评估”，最终删掉大量原本可能演化成第二套 Runtime / Scheduler / Store / Browser topology 的复杂度。**

这应成为 Batch4 前最后一次架构收敛的正式基线。

---

# 38. X7｜决策权、推理升级与“谁有资格做决定”

> 本节为 v2 的**追加裁决**。前 1～37 节内容保持原样，不做任何改写。  
> 这一项用于把前文已经分散出现、但尚未单独形成总规则的“确定性规则 / GPT Worker / FAST / REASON / Human / Owner Domain”决策边界统一冻结。

## 38.1 为什么还需要这一项

ProFlow 第一版已经同时存在多种“会做判断的东西”：

```text
Task Domain
Execution Policy
Task Observer
System Observer
Custom GPT Worker
FAST model
REASON model
Vision model
Browser Carrier
Human
```

如果只描述“它们分别能做什么”，但不回答：

> **发生冲突时谁说了算？什么时候允许从规则升级到模型？模型的判断能不能直接改变正式状态？什么时候必须交给人？**

后续实现很容易再次长出第二套 Planner、Scheduler、Policy 或隐式业务状态。

因此必须再冻结一条横切总原则：

> **ProFlow 的“智能”可以分布在很多地方，但“决策权”不能模糊。认知能力与业务权威必须分离。**

---

## 38.2 第一原则：事实权威优先于模型判断

任何时候：

```text
Owner Domain current fact
>
Observer assessment
>
Model inference
>
Conversation memory
>
Browser DOM impression
>
Log-derived guess
```

例如：

```text
Task Store = Node READY
GPT 说“这个任务已经完成”
```

最终仍然是：

```text
Node READY
```

又例如：

```text
Execution = UNKNOWN
REASON 判断“应该已经成功”
```

正式结果仍然是：

```text
UNKNOWN
```

直到 Execution 获得真实 Evidence 或经过合法恢复流程重新确定。

### 冻结裁决

模型可以：

```text
理解
归因
建议
排序
提出下一步观察
```

模型不能凭“看起来很合理”覆盖 Owner Domain 的正式事实。

---

## 38.3 第二原则：确定性规则优先于任何模型

只要问题可以通过 Frozen Contract、状态机、不变量、版本、幂等规则和真实状态直接判断，就不调用模型。

例如：

```text
Node READY
→ required Worker 已绑定
→ 当前 run 尚未 WAKE
```

这是确定性条件：

```text
Task Observer → WAKE
```

不需要 FAST，更不需要 REASON。

再例如：

```text
Execution WAITING_APPROVAL
```

这是正式事实：

```text
展示审批入口
```

不需要模型判断“要不要显示”。

### 原因

模型介入确定性问题只会增加：

```text
延迟
token / 手机算力消耗
不稳定性
可审计难度
行为漂移
```

因此：

> **规则能判定，就绝不“为了智能”调用模型。**

---

## 38.4 第三原则：GPT Worker 与平台模型不是同一种角色

这是后续实现必须保持清楚的边界。

### Custom GPT Worker

负责：

```text
理解业务
分析需求
设计方案
写代码思路
分析测试结果
使用 File Bridge / Code Interpreter / Web Search
调用正式 Actions
跨 Worker 协作
```

它代表的是：

> **当前 Task 中某个岗位的智能工作人员。**

### FAST / REASON / Vision

负责的是平台内部的受控推理能力：

```text
FAST
→ 高频结构化判断、摘要、格式化、普通决策

REASON
→ 少量高难度歧义、冲突、系统诊断、跨域归因

Vision
→ screenshot / image structured observation
```

它们不是 Task 中的第四个 Worker，也不是新的 Agent Role。

### 冻结裁决

```text
GPT Worker
≠ FAST
≠ REASON
≠ System Observer
```

不得把手机模型包装成新的“Controller Agent”。

---

## 38.5 第四原则：第一版统一采用“最小升级链”

当一个平台判断确实不能只靠规则完成时，升级顺序应尽量保持：

```text
Hard Rule / Owner Fact
        ↓
Deterministic Logic
        ↓
FAST（如普通语义判断足够）
        ↓
REASON（仅真正歧义/复杂归因）
        ↓
Human（高风险、仍不确定或需要授权）
```

不是所有场景都必须经过每一层。

例如：

### 普通结构化归纳

```text
日志摘要
→ FAST
```

### 单 Task 复杂 stalled 归因

```text
deterministic facts 无法解释
→ REASON
```

### 危险文件删除

即使 REASON 认为“应该删除”：

```text
Execution Policy
→ REQUIRE_APPROVAL
→ Human
```

模型永远不能绕过安全边界。

---

## 38.6 第五原则：FAST 与 REASON 的使用不是“能力越强越优先”

第一版正式方向仍然是：

```text
FAST = 默认、高频、低成本路径
REASON = 低频升级路径
```

原因不是 REASON 不够好，而是整个 ProFlow 需要：

```text
可预测
低延迟
低资源占用
手机稳定
易回归
易审计
```

REASON 应只用于：

```text
证据冲突
未知副作用
复杂根因
跨域系统性问题
多异常排序
长期 stalled 且规则无法解释
```

如果只是：

```text
schema normalize
summary
routing hint
状态解释
普通文本理解
```

优先 FAST 或直接 deterministic。

---

## 38.7 第六原则：模型输出必须进入“建议”或“结构化判断”，不能直接成为 Effect

任何模型调用应先得到一个结构化结果，例如：

```text
decision
confidence
finding
risk
recommendedAction
needsHumanAttention
needsDrilldown
```

然后再由正式 Controller / Owner 决定是否合法执行。

禁止：

```text
REASON text
→ shell
```

禁止：

```text
Vision says button exists
→ Task complete
```

禁止：

```text
System Observer says restart
→ restart all services
```

应是：

```text
Model Assessment
→ typed recommendation/request
→ Owner / Controller validation
→ Execution / formal transition
```

---

## 38.8 第七原则：Task Observer 的模型旁路必须是“诊断”，不是“调度”

Task Observer 主链：

```text
formal facts
→ deterministic condition
→ typed request
```

只有在：

```text
AMBIGUOUS
UNKNOWN
repeated recovery failure
conflicting facts
unexplained stalled
```

时，才允许：

```text
Task Diagnostic Assessment
→ REASON
```

而 REASON 只能回答：

```text
最可能发生了什么？
接下来应该观察什么？
哪个恢复方向优先？
是否需要人工？
```

不能回答并直接实施：

```text
“我决定 reopen”
“我决定 complete”
“我决定重发这个未知 Effect”
```

### 核心裁决

> **Task Observer 可以借用思考模型，但不能把工作流权威交给思考模型。**

---

## 38.9 第八原则：System Observer 的 REASON 是“系统评估器”，不是“系统管理员”

System Observer 确实需要 REASON，因为它要做的不是单状态判断，而是：

```text
跨 Task
跨 Execution
跨 Carrier
跨 Model
跨 Deployment
跨日志趋势
```

形成系统级认知。

但其输出仍然只是：

```text
assessment
finding
risk
hypothesis
recommendation
```

不是 Owner fact。

例如 REASON 得出：

```text
Probable Carrier UI Drift
confidence = 0.91
```

它可以触发：

```text
请求 Carrier doctor
请求 targeted screenshot
提醒用户
请求进一步 drill-down
```

不能直接：

```text
修改所有 Worker binding
重置所有 Task
宣告 Browser service FAILED
```

除非对应 Owner 自己依据正式规则产生这些事实。

---

## 38.10 第九原则：Human 不是“所有异常的兜底按钮”

第一版虽然保留人工，但也不能设计成：

```text
UNKNOWN
→ 一律问用户
```

合理顺序应是：

```text
先重新观察 reality
→ 尝试安全 deterministic recovery
→ 必要时模型 diagnosis
→ 能继续自动恢复则继续
→ 真正涉及授权 / 高风险 / 无法判定才找 Human
```

Human 主要负责：

```text
安全授权
不可自动完成的 Web-only 动作
最终不可消歧判断
明确业务确认
```

不是替平台修每一个 transient failure。

---

## 38.11 第十原则：Conversation memory 只能辅助认知，不能代替 fresh reality

Worker Conversation 具有长期上下文，这是 ProFlow 的重要优势。

但：

```text
Conversation remembered state
≠ Owner current state
```

所以：

```text
GPT 记得上次 execution running
```

不能假设现在仍然 running。

写操作前仍必须依赖：

```text
current state
expectedVersion
idempotency
formal Action result
```

### 裁决

Conversation memory 用于减少重复解释，不用于绕过 fresh-state validation。

---

## 38.12 第十一原则：模型置信度不能替代 Policy

无论 FAST / REASON 给出：

```text
confidence = 0.99
```

只要动作属于：

```text
REQUIRE_APPROVAL
DENY
scope violation
identity mismatch
expired approval
```

都必须服从确定性 Policy。

因此：

```text
Policy
>
Model confidence
```

始终成立。

---

## 38.13 第十二原则：模型调用失败不能破坏业务真源

手机：

```text
offline
busy
model_busy
server_paused
timeout
parse error
```

都只能造成：

```text
assessment unavailable
diagnostic deferred
fallback
```

不能造成：

```text
Task state corrupt
Execution result lost
Worker binding lost
业务事实回滚错误
```

特别是 System Observer：

```text
REASON 不可用
→ 本轮 assessment defer
```

系统继续正常工作。

这是为什么 System Observer 必须最低优先级、非主链依赖。

---

# 38.14 决策权矩阵

| 场景 | 首选判断者 | 模型角色 | 最终权威 |
|---|---|---|---|
| Node READY 是否 Wake | Task Observer deterministic | 无 | Task facts + Carrier result |
| Execution 是否成功 | Execution | 可辅助诊断 | Execution Result/Evidence |
| 是否需要危险审批 | Execution Policy | 不可覆盖 | Execution |
| 页面是否可操作 | Carrier deterministic | Vision fallback | Carrier observation |
| Task 为什么异常 stalled | Task Diagnostic | REASON 可归因 | Task facts不变 |
| 系统是否整体退化 | System Observer | REASON 主评估 | 派生 assessment，不覆盖 Owner |
| 公开技术资料研究 | Custom GPT | Web Search | Worker judgment + formal Action when needed |
| 多文件代码分析 | Custom GPT | Code Interpreter | Worker proposal |
| patch 是否真实生效 | Execution | GPT只生成候选 | Execution Evidence |
| 是否启动 Task | Human channel + Task rules | 无需模型 | Task |
| 是否允许危险 Effect | Human + Execution approval | 模型不能授权 | Execution |
| Web-only 配置是否完成 | Deployment re-observe | 模型可解释 | Deployment |

---

# 38.15 对 Batch4 的直接实现要求

后续代码/文档审计必须检查是否出现以下 architecture drift：

```text
正常 Task progression 调 REASON
System Observer 直接执行副作用
FAST/REASON 被注册成第四个 Worker
GPT 回复文本直接触发 Task transition
模型 confidence 绕过 Approval
手机模型不可用导致 Task 主链停止
Conversation memory 代替 expectedVersion/current read
Vision 结果直接成为业务成功事实
```

这些都应视为需要修正。

---

# 38.16 本项最终裁决

可以把整个 ProFlow 第一版的“谁负责思考、谁负责决定”压缩成：

```text
事实
→ Owner Domain

规则
→ Deterministic Logic

普通语义认知
→ GPT Native / FAST

复杂歧义与系统归因
→ REASON

视觉理解
→ Vision

真实副作用
→ Execution

高风险授权
→ Human + Owner Approval

流程推进
→ Task + Task Observer

系统整体判断
→ System Observer + REASON
```

最终最重要的一句话是：

> **模型负责提高认知质量，不负责夺取业务权威；Observer 负责发现和评估，不负责成为新的 Owner；Execution 负责真实 Effect，Task 负责工作流事实。**

这条原则应作为后续 Batch4 文档和实现审计的最高层横切检查项之一。

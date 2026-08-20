---
docId: PLATFORM-DOC-01-04
title: 04｜Task Journey、Custom GPT Carrier 与 Observer v1 集成基线
docType: cross-domain-architecture
authority: normative
lifecycle: active
domain: platform
canonicalFor:
- proflow.task-journey.v1
- proflow.observer-boundary.v1
- proflow.custom-gpt-carrier.integration.v1
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs: []
---

# 04｜Task Journey、Custom GPT Carrier 与 Observer v1 集成基线

> 本文冻结 2026-08-14 Batch4 前跨领域架构收敛。它不是第六领域，也不创造新的业务真源；它只定义 Task、Agent、Execution、Model、Deployment、Extension 在同一 Task Journey 中如何组合。发生冲突时，各 Owner Domain 的 canonical 文档仍负责本领域状态/Contract 细节，本文负责跨域组合边界。

## 1. v1 总体目标

第一版不再扩张为自建 Agent Runtime / Browser Orchestration Platform。平台优先复用 Custom GPT 已有 Conversation、Actions、File Bridge、Code Interpreter、Web Search 与同一 Turn 内连续 Action 能力；ProFlow 只拥有自身必须拥有的长期事实、真实 Effect、身份绑定、恢复、流程治理和系统级评估。

```text
Task truth                 → Task Domain
Role/Worker/Collaboration  → Agent Domain
real Effect/Result/Evidence→ Execution Domain
FAST/REASON/Vision         → Model Domain
Module governance / install-status-setup-start-stop → Deployment Domain
page create/restore/wake   → Execution-owned Browser Carrier
Task next-step detection   → Task Observer（Extension application logic）
system assessment          → System Observer + Model REASON
```

## 2. 固定三角色

v1 固定三个泛化 Agent Package：

```text
Product
Controller / Dev
Test / Ops
```

`packageName/agentPackageRef` 是逻辑岗位 identity；`roleRef` 是当前真实 Custom GPT g-id；`workerRef` 是 Task 内具体 Conversation/c-id；`conversationLocator` 是可恢复页面 locator；role-scoped credential 只用于 GPT Action → Gateway auth。

禁止新增 RoleType、AgentType、Persona、专业化 Role、动态 Agent discovery/capability matching。专业知识未来通过 Knowledge 增量吸收，不进入 v1。

## 3. Task Journey

```text
J0 Role Ready
→ J1 Extension New Task + 三 Worker 一次建立 + Product requirement
→ J2 User Confirm → Task Start → first Node READY
→ J3 Task Observer → RESTORE/WAKE correct Worker
→ J4 Worker Turn → GPT Native / Actions / Execution / Collaboration
→ J5 Result → Next / Wait / Reopen / Recovery
→ J6 Terminal → stop driving / retain history
```

### J0

Role READY 的业务合格标准由 Agent/Carrier owner 定义；对应 Module 通过 `setup/status` 与必要的 Module-specific verification extra 观察真实行为/能力、Actions/auth、required capabilities。Platform Deployment 只聚合标准状态，不 pin 精确 model id。

### J1

Extension 是唯一 New Task 入口：先创建 `PENDING` Task，再并发创建/识别三个 Role 的新 Conversation 并 one-time bind。Product 一旦 bind 即可开始 requirement discussion；Dev/Test 只做最小 bind 后 IDLE。已成功 Worker 必须保留，只补缺失 Worker。

Product GPT 不再承担主链 `createTask` / `listRegisteredRoles`；这两个能力若保留，仅是 owner/management surface，不进入 Product GPT Action main path。

### J2

“批准并开始”是 Extension v1 人机交互，不建立 Task Approval Entity。Task 只接收合法 `startTask` command，并重新校验 requirement、三 Worker binding、版本、幂等与当前状态。未来 Feishu 只替换 human interaction channel。

### J3

Node READY 后 Task Observer 读取正式 facts，要求 Carrier 恢复正确 Conversation 并提交 minimal wake：

```text
taskId
nodeId
runNo
workerRef
trigger
```

WAKE 成功只表示物理消息进入正确 Conversation，不表示 Node/Execution 成功。Browser 不注入大型 Task 文档；动态上下文走 Owner APIs / File Bridge。

### J4

一个 WAKE/input 形成一个语义上的 Worker Turn。Worker Turn 不是实体/Store/Runtime；它只表示 GPT 可以在同一 Conversation 中连续 reasoning → 0..N Actions → results → next Actions。平台不得在每个 Action 中间 Browser WAKE 或自动发送“继续”。

### J5

Execution pending、Peer pending、Execution Approval pending 默认分别留在各 Owner；只有真正 workflow 被业务阻塞时才进入 Task WAITING。Reopen 是业务返工：same taskId/nodeId/workerRef/Conversation，`runNo + 1`；Recovery 是技术恢复，不改变 Task business truth。

### J6

Task terminal 后 Task Observer 停止业务驱动。保留 TaskRoleBinding / roleRef / workerRef / conversationLocator、Collaboration history、Execution Result/Evidence/Artifact 与 structured logs。Conversation 是历史工作载体，不是正式 Archive truth。

## 4. TaskRoleBinding / Node requirement

Node 的逻辑岗位要求必须使用 `requiredAgentPackageRef`（其值为固定 Agent packageName），不得把真实 g-id 当作“角色类型”。TaskRoleBinding 至少表达：

```text
agentPackageRef
roleRef
workerRef
conversationLocator
```

Task 只把后三者当 opaque binding facts，不解析 g-id/c-id/URL 结构。Browser tab/window/content identity 永远 transient，不进入 Task binding。

## 5. Browser Carrier v1 最小能力

KEEP：

```text
create/open Conversation
observe c-id/locator
reuse/focus tab
restore locator
wait page ready
scroll bottom
programmatic input/submit
observe delivery
screenshot
Vision fallback
bounded retry
UNKNOWN reconciliation
structured operation result
```

REMOVE/REJECT：

```text
frame registry / frame-role handshake / iframe workspace
persistent tab identity
complex tab/frame topology
dynamic agent topology
Browser business message/orchestration store
Browser ordinary file manager
DOM natural-language Task completion
mouse/keyboard coordinate automation
```

Background/Service Worker 是唯一 Carrier Controller；页面 DOM 操作通过受控 Content Script / scripting.executeScript。DOM deterministic observation first；截图 + Vision 只作 ambiguity/recovery fallback。

## 6. Native GPT capability reuse

```text
需要公开知识             → Web Search
多文件/数据/代码临时分析 → Code Interpreter
Conversation↔平台文件    → File Bridge
正式 ProFlow facts       → GPT Actions → Owner Domain
真实机器/外部 Effect      → Execution
跨 Worker                → Collaboration
```

File Bridge 是 transport，不是 File/Artifact/Document Store。Context Pack、Patch 都是 Execution Artifact subtype；真实 bytes materialize/hash/MIME/size/scope 由 Execution 负责。Screenshot/Vision 路径保持独立，因为 Action file response 不能作为平台→GPT image/video 主链。

## 7. Observer 双线

### Task Observer

确定性 progression detector：读取 Task/Execution/Collaboration/Carrier 的当前公开 facts，发现 Node READY、Execution Result READY、Peer Reply READY、Reopen READY、需要恢复的未完成 wake 等明确条件后发 typed request。默认不调用模型，也不直接修改任何 Owner business state。

只有单 Task 出现多源冲突、UNKNOWN、长期 stalled 无单一 blocker、重复 recovery 失败时，允许调用 REASON 做 Task Diagnostic Assessment；模型只能输出 finding/recommendation，不得 complete/reopen/approve/重放 Effect。

### System Observer

最低优先级独立系统评估器。它不是“全局待办处理器”，而是读取 Task、Worker/Role、Collaboration、Execution、Carrier、Model、Deployment、Logs/Artifacts/Evidence 的 bounded views，使用手机 REASON 形成 system assessment/findings/risks/recommendations。Assessment 是派生诊断，不覆盖 Owner facts。

## 8. System Observer 推理方式

禁止 full DB/full logs/full artifacts 一次性灌入 4B REASON。采用：

```text
Layer 1 deterministic compact snapshots
→ Layer 2 concern/domain batches
→ optional targeted drill-down
→ Layer 3 global synthesis
```

默认 concern batches 可按：Task+Worker、Execution+Approval、Collaboration+Carrier、Model+Deployment+Health。每批输出结构化 findings/risks/anomalies/unresolved/needsDrilldown/evidenceRefs/confidence/carryForward。

跨轮次记忆显式 carry-forward previous unresolved findings / hypotheses / refs，不依赖 MLXHub 会话历史。Assessment 可作为 bounded diagnostic artifact 保存，但不得成为第二业务 Store。

## 9. 决策权与升级链

权威顺序：

```text
Owner current fact
> deterministic invariant/policy
> observer/model assessment
> Conversation memory
> DOM/log guess
```

平台最小升级链：

```text
Hard Rule / Owner Fact
→ Deterministic Logic
→ FAST（普通语义）
→ REASON（复杂歧义/归因）
→ Human（授权/高风险/仍不可消歧）
```

模型提高认知质量，不夺取业务权威；model confidence 永远不能覆盖 DENY/REQUIRE_APPROVAL/scope/identity/version/idempotency rules。

## 10. Approval 四分

```text
Task start confirmation → Extension v1 / Feishu future；不是 Task Approval fact
Execution safety approval → Execution owner fact
Module.setup ACTION_REQUIRED → human/external action + Module re-observe reality
ChatGPT Action permission → OpenAI UI；routine non-consequential main path 使用 Always Allow
```

Unexpected Action permission prompt 是 Carrier recovery/interaction，不是 Execution Approval。

## 11. Logging / Trace

Business Fact、Evidence、Structured Log 必须分开。统一 trace axes：

```text
taskId / nodeId / runNo
agentPackageRef / roleRef / workerRef
executionRef / messageRef / artifactRef
correlationId
```

`tabId/operationRef/attemptNo` 只用于 transient diagnostics。不得保存 raw credential、Authorization、完整 prompt/reply/file/screenshot binary；不伪造 GPT internal reasoning/Web Search/Code Interpreter telemetry。

## 12. 恢复总原则

任何真实 Effect 重试前先判断 Effect reality：

```text
confirmed absent → bounded retry
confirmed success → reuse
uncertain → UNKNOWN → observe reality
still unknown → no blind replay / diagnosis / human if necessary
```

Browser 不建设第二套 durable Effect Runtime；优先复用 Execution 的 durable side-effect/result/evidence/recovery 语义。

## 13. Batch4 architecture drift guard

若文档/实现重新出现以下内容，应视为 drift：

```text
Product GPT 主链 createTask/listRegisteredRoles
Task start Approval Entity/APPROVAL_PENDING
Node 用真实 roleRef/g-id 表达逻辑岗位类型
每 Action 一次 Browser WAKE
frame/frameId 业务架构
Browser 大 Context/普通文件 DOM 搬运
Browser NLP 判断 Node Result
Task Observer 正常 READY/RESULT/REPLY 调 REASON
System Observer 直接执行副作用/改 Owner fact
手机模型不可用导致 Task 主链停摆
Conversation memory 替代 fresh owner read/version validation
```

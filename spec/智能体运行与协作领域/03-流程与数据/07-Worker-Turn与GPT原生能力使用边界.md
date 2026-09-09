---
docId: AGENT-DOC-03-07
title: 智能体运行与协作领域｜Worker Turn 与 GPT 原生能力使用边界
docType: carrier-flow
authority: normative
lifecycle: active
domain: agent-runtime-collaboration
boundedContext: agent-runtime-collaboration
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- PLATFORM-DOC-01-04
- AGENT-DOC-02-02
---

# 智能体运行与协作领域｜Worker Turn 与 GPT 原生能力使用边界

## 1. Worker Turn 只是运行语义

一次用户输入或 Browser WAKE 后，Custom GPT 可以在同一个 Conversation 中继续 reasoning、调用 0..N 个 Actions、接收 Action result 后继续工作。ProFlow 把这段连续工作称为 Worker Turn，仅用于描述边界；不建立 WorkerTurn Entity/Store/Runtime/Scheduler。

## 2. Browser 不进入每个 Action 中间

正常 happy path：

```text
WAKE once
→ GPT reasoning
→ Action A
→ result
→ Action B
→ result
→ final/formal action
```

禁止：

```text
Action A → Browser send “继续” → Action B
每 Action 一个 Task Node
每 Action 一个 Browser wake intent
DOM 判断 GPT 是否“需要继续”
```

只有真正异步边界（Browser/Carrier durable Effect、Peer reply、Execution Approval、Carrier recovery）使当前 Turn 自然结束后，backend Task Observer/Reconciliation 才在新事实 ready 时再次 WAKE 同一 Worker。

## 3. Native capability first

```text
公开知识/资料 → Web Search
临时文件/数据分析 → Code Interpreter
正式 Task/Node/Document facts → Task Actions
广域仓库上下文 → Repomix
代码结构/调用/依赖/impact → CodeGraph
当前磁盘真值、修改、命令、进程/端口 → Local Dev
Browser/Carrier durable Effect → Execution internal path
跨 Worker → Collaboration
```

不建立 Tool Router AI；Agent Instructions 直接教会 Worker 使用以上简单规则。

## 4. File / repo 主路径

大量动态 Task Context 不由 Browser 注入。TaskDocument 继续走 File Bridge；真实仓库调查优先 Repomix/CodeGraph，真实修改与验证走 Local Dev。Code Interpreter 只处理 Conversation 沙箱材料，不能证明 macOS repo 已修改。

Local Tool 的长进程使用 `Local Dev.process` 原生 process handle，不创建 ProFlow `executionRef` 轮询。

## 5. Fresh reality

Conversation memory 可以减少重复解释，但不能替代 Owner current state。任何正式写入仍依赖 Action result、expectedVersion/idempotency/current validation。

## 6. Routine Action permission

Role OpenAPI 对不直接产生不可逆真实 Effect 的平台 query/control/intent operation 可显式 `x-openai-isConsequential:false`，但 Worker Turn 不假设用户历史上的一次 `Always Allow` 会永久消除 ChatGPT Permission。

Permission 是 Browser Carrier mechanical gate：Carrier 从当前页面提取 permission facts，再以当前 Role/Worker、trusted ProFlow target、Role authorized operation 与稳定 fingerprint 做分类。可信 routine automation 可由 Carrier 自动 `Always Allow` 并验证 Turn 继续；未知 target/operation/context 或无法消歧时 fail closed，进入 Carrier Attention/diagnostic。Worker/Workflow/Collaboration 不感知具体 Permission DOM case。

`x-openai-isConsequential:false` 不是单独的 auto-grant 依据；Execution Effect Approval 仍完全独立，Carrier permission 不得替代或绕过它。

首次 Worker Turn 的 Permission 可能早于 TaskRoleBinding 完成绑定。只有 current Role/target/operation 与真实 `/g/{role}/c/{worker}` 已全部验证，且相同 Task/Role binding 已存在但 `workerRef + conversationLocator` 同时为空时，Carrier 才可短暂 `DEFER` 并 bounded reclassify；期间不得点击或通知人工。任何 binding 冲突或超时仍 fail closed。人工 `deny` 只否决当前 Carrier continuation occurrence，不是 Role/Worker 永久禁用，也不是 Agent/Collaboration fact。

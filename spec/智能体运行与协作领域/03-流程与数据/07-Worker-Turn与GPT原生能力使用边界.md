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

只有真正异步边界（长 Execution、Peer reply、Execution Approval、Carrier recovery）使当前 Turn 自然结束后，Task Observer 才在新事实 ready 时再次 WAKE 同一 Worker。

## 3. Native capability first

```text
公开知识/资料 → Web Search
文件/数据/代码临时分析 → Code Interpreter
Conversation 文件 ↔ ProFlow → File Bridge
正式平台事实 → Actions
真实 Effect → Execution
跨 Worker → Collaboration
```

不建立 Tool Router AI；Agent Instructions 直接教会 Worker 使用以上简单规则。

## 4. File/Artifact 主路径

大量动态 Task Context 不由 Browser 注入。推荐：

```text
Execution bounded Context Pack
→ File Bridge
→ GPT + Code Interpreter
→ patch/report/findings
→ File Bridge
→ Execution materialize/validate/apply/test
```

Context Pack / Patch 是 Execution Artifact subtype，不是 Agent-owned文件实体。

## 5. Fresh reality

Conversation memory 可以减少重复解释，但不能替代 Owner current state。任何正式写入仍依赖 Action result、expectedVersion/idempotency/current validation。

## 6. Routine Action permission

Role OpenAPI 对不直接产生不可逆真实 Effect 的平台 query/control/intent operation 显式 `x-openai-isConsequential:false`。目标主链按用户已选择 Always Allow 设计；Browser 不把 routine permission click 当正常步骤。Unexpected prompt 只进入 recovery/human interaction。Execution Effect Approval 仍完全独立。

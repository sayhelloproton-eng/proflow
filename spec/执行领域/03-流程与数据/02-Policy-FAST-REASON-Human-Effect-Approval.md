---
docId: EXECUTION-DOC-03-02
title: 08 · Policy、FAST、REASON、Human 与 Effect Approval
docType: policy-flow
authority: normative
lifecycle: active
domain: execution
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- PLATFORM-DOC-01-04
- MODEL-DOC-03-08
---

# 08 · Policy、FAST、REASON、Human 与 Effect Approval

## 1. 决策权先于“模型强弱”

冻结优先级：

```text
Owner current fact / hard invariant / Effect Policy
>
deterministic logic
>
FAST semantic judgement
>
REASON ambiguity/diagnosis
>
Human authorization/irreducible judgement
```

模型负责提高认知质量，不获得业务权威；`confidence=0.99` 也不能覆盖 DENY/REQUIRE_APPROVAL/scope/identity/version/idempotency。

---

## 2. Layer 1 — Deterministic

必须优先确定性处理：

```text
schema/runtime validation
caller/role/worker identity
projectRoot/path/scope
hard deny
known read-only safe rule
approval fingerprint/expiry/scope
idempotency conflict
current execution state
```

模型不可覆盖。

---

## 3. Layer 2 — FAST

只有 deterministic facts 足够安全但仍需要普通语义判断时才调用 FAST，例如：

```text
bounded risk classification
structured summary/normalization
ordinary ambiguous command semantics
low-cost diagnostic hint
```

FAST 是默认低成本模型路径；不是每次 Execution 都必须调用模型。

---

## 4. Layer 3 — REASON

只用于真正复杂：

```text
conflicting evidence
UNKNOWN diagnosis
unknown side-effect semantics
complex root cause
multi-signal prioritization
Task/System diagnostic requested by Observer
```

FAST/REASON 共用手机单 Lane，不能假设并行。

---

## 5. Layer 4 — Human

Human 主要负责：

```text
安全授权
Web-only不可自动完成动作
REASON 后仍不可消歧
需要业务责任确认
```

不是 transient error 的默认兜底；先 reality observation → safe deterministic recovery → 必要 model diagnosis，再决定是否找人。

---

## 6. Effect Approval

Approval 必须绑定具体 Effect：

```text
executionRef/caller
capability
target
critical params
fingerprint
precondition
scope
expiry
actor
```

Approval 回来必须 revalidate current reality；stale approval 不能执行。

---

## 7. 四类“确认/审批”严格分层

### Task start confirmation

Extension v1 / Feishu future → `startTask`。Task 不拥有 Approval fact。

### Execution Effect Approval

Execution Owner truth；本文只描述这一类正式安全 Approval。

### Deployment ACTION_REQUIRED(_WEB)

Human action 完成后 Deployment re-observe reality，不是 approve flag。

### ChatGPT Action permission

OpenAI UI fact。Routine query/control/intent operation：

```text
x-openai-isConsequential:false
+ user Always Allow
```

目标是退出 happy path。Unexpected prompt 才进入 Carrier recovery。

---

## 8. `executeCapability` 等 GPT Action 的 consequential 语义

如果 GPT-facing Action 只是“向 Execution durable plane 提交一个 typed intent/request”，真正 Effect 仍由 Execution Policy 决定，那么 Action 本身应是 routine platform control/intent：

```text
x-openai-isConsequential:false
```

这**绝不**意味着真实 capability 获得 ALLOW。Execution 仍执行：

```text
identity/scope
→ Policy
→ approval validity
→ real Effect
```

因此 OpenAI confirmation 不再重复平台自己的 Effect Approval。

---

## 9. Browser permission fallback

只有 unexpected prompt / schema-domain-auth drift / consequential external UI confirmation 等情况才走 fallback：

```text
preserve page
→ screenshot/log bounded evidence
→ human/known safe recovery
→ revalidate reality
→ resume continuation
```

Browser 不自动点击所有 routine prompts。

---

## 10. Decision logs

Execution Record 可记录：

```text
decisionPath
policyRuleRefs
decision summary
modelCallRef / assessmentRef（如有）
approvalRef
confidence（仅诊断）
```

不记录 private chain-of-thought；只保存结构化可审计结论。

---

## 11. Observer 调用模型不改变 Execution authority

Task Diagnostic/System Observer 可以向 Model Runtime请求 REASON分析 Execution summary，但输出只是 finding/recommendation。`Execution.status/sideEffectState/Result/Evidence` 只能由 Execution current reality改变。

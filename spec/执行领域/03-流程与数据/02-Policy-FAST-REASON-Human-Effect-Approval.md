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

OpenAI UI/Carrier reality，不是 ProFlow 权限真源。当前 shipped Product / Controller-Dev / Test-Ops 三套 Custom GPT Action schema 的**每个 operation 均显式**：

```text
x-openai-isConsequential:false
```

ordinary Action happy path 不依赖用户预先配置 `Always Allow`，也不把 ChatGPT confirmation 当成本机 Effect 授权。若 legacy conversation、Carrier 漂移或 ChatGPT UI 变化仍出现 Permission surface，进入 Browser Carrier deterministic recovery：先读取当前页面的 permission facts 与当前 Role/Worker/target/operation/session，再分类并验证真实 release；未知或无法消歧时 fail closed。

---

## 8. GPT Actions 与内部 Execution Approval 的 consequential 语义

GPT 不再暴露 `executeCapability/getExecution/readExecutionOutput`。2026-09-13 起，三个 shipped GPT Action schema 的所有 operation 固定为 `x-openai-isConsequential:false`，包括混合读写的 `localDev` HTTP operation。该字段只控制 OpenAI Carrier 层的 consequence confirmation，**不表示 operation 无副作用，也不赋予本机权限**。

真实本机 Tool Effect 仍必须经过：

```text
Gateway Role authentication
→ Role × Tool × Operation / nested action admission
→ Browser Extension Effect Gate
→ server-bound Workspace / canonical target validation
→ execution-local provider safety / deadline
→ UNKNOWN no-blind-replay
```

Browser/Carrier/materialization 等仍进入 durable Execution 的内部 Effect 若需要正式 Approval，继续执行：

```text
identity/scope → Effect Policy → Approval validity → durable Effect
```

OpenAI Carrier confirmation、Browser Extension Local Tool Effect Gate、Execution internal Approval 是三层不同机制，任何一层都不得被另一层的 `false` metadata 或 permission click 替代。

---

## 9. Browser permission fallback

只有 unexpected Permission / schema-domain-auth drift / legacy Conversation / Carrier reality drift 等情况才走 fallback；它不是 ordinary Action 的正常调度步骤：

```text
preserve current page
→ DOM-first typed permission facts + fingerprint
→ authoritative Role/Worker/target/operation classification
→ revalidate same content/URL/fingerprint
→ trusted AUTO_ALLOW：仅选择当前页面真实提供的 allowAlways，或其不存在时 allow
→ observe permission release / continuation reality
```

`allowOnce` 属人工 Carrier Attention 的一次性动作，不是 routine auto-grant。若 target/operation/context 未知、只有 `allowOnce`、classification/reality 不确定或 human deny 命中，保持 BLOCKED / HUMAN_REQUIRED；不得猜测点击。DOM 无法安全解释时才补 screenshot/Vision bounded evidence，Vision 不覆盖硬规则。

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

Browser Carrier Permission 另记录 classification、semantic action dispatch、release/reality；不能只记录“决定 AUTO_ALLOW”而缺失真实动作/结果证据。它仍不是 Execution Approval 记录。

不记录 private chain-of-thought；只保存结构化可审计结论。

---

## 11. Observer 调用模型不改变 Execution authority

Task Diagnostic/System Observer 可以向 Model Runtime请求 REASON分析 Execution summary，但输出只是 finding/recommendation。`Execution.status/sideEffectState/Result/Evidence` 只能由 Execution current reality改变。

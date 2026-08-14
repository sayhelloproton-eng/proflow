---
docId: AGENT-LIMITATIONS
title: 智能体运行与协作领域｜待确认项、限制与 Spike
docType: limitations
authority: normative
lifecycle: active
domain: agent-runtime-collaboration
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs: []
---

# 智能体运行与协作领域｜待确认项、限制与 Spike

## 状态规则

```text
TODO = 正确目标和实施方法已经确定，但尚未完成
PENDING_SPIKE = 外部行为或关键假设尚未通过真实验证
KNOWN_LIMITATION = 已知限制，必须有当前 fallback / operator action
FUTURE = 不属于 v1 当前范围
```

任何 `PENDING_SPIKE` 都不得成为没有 fallback 的 correctness dependency。只有真实 E2E/实验通过，并确认不破坏 ownership / contract / recovery 后，才可提升为正式主路径。

## OAI-CARRIER-001｜Always Allow 真实环境证明
- Architecture Status: `FROZEN_PRIMARY_PATH`
- Validation Status: `FINAL_MANUAL_E2E_PENDING`
- 正式路径：routine Action 使用 `x-openai-isConsequential:false`，用户完成 `Always Allow` 后 happy path 不再由 Browser 逐次点击 permission。
- Unexpected permission prompt: Carrier recovery / human interaction condition，不是 Execution Approval，也不恢复 action-level Browser scheduler。

## OAI-CARRIER-002｜Multi-Action Worker Turn 真实环境证明
- Architecture Status: `FROZEN_PRIMARY_PATH`
- Validation Status: `FINAL_MANUAL_E2E_PENDING`
- 正式路径：一次 WAKE 可形成一个语义 Worker Turn，同一 Conversation 内可连续 `0..N` Actions；Browser 不在每个 Action 中间 WAKE/发送“继续”。
- 若真实目标环境发生中断：只在确实需要新 Turn 时恢复同一 Worker，并先重读 Owner current facts；不得恢复 action-level Browser scheduler 或重放已成功 Effect。

## OAI-CARRIER-003｜Conversation-native file handling 真实环境证明
- Architecture Status: `FROZEN_REUSE`
- Validation Status: `FINAL_MANUAL_E2E_PENDING`
- 正式边界：File Bridge 负责传输；TaskDocument/Execution Artifact 继续是平台正式引用，Conversation file 永不成为 canonical truth。

## OAI-CARRIER-004｜Context Pack → Code Interpreter → Patch round trip 真实环境证明
- Architecture Status: `FROZEN_REUSE`
- Validation Status: `FINAL_MANUAL_E2E_PENDING`
- 正式边界：Context Pack/Patch 都是 Execution Artifact subtype；GPT/Code Interpreter 只产候选 Artifact，真实 apply/test/evidence 仍由 Execution。具体 pack 格式可根据真实 E2E 调整。

## OAI-CARRIER-005｜ZIP Context Pack
- Type: `PENDING_SPIKE`
- 目标：验证 ZIP 作为动态代码上下文载体的兼容性和可重复性。
- Current fallback: 多文件明确传输，不依赖 ZIP。
- Blocks P0: No。

## AGT-CARRIER-006｜非 Browser 的 c-id shortcut
- Type: `PENDING_SPIKE`
- 当前 correctness path: Browser 从真实 Conversation URL 观察/校验 c-id。
- 任何 current-link/Action shortcut 只能作为优化，未验证前不能替代 Browser identity path。

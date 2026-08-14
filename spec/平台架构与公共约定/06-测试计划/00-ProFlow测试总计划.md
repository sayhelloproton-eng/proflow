---
docId: TP-PLATFORM-00
title: ProFlow 测试总计划
docType: test-plan
authority: normative
lifecycle: active
domain: platform
subdomain: null
subdomains: []
boundedContext: null
moduleRef: null
provides: []
requires: []
contractRefs: []
testPlanPhase: PRE_IMPLEMENTATION
testPlanStatus: FINAL_FROZEN
sourceBaseline: ProFlow-ProFlow-DDD规范化技术文档-最终冻结基线-20260812.zip
sourceBaselineSha256: 69fdfbac8a5ee36b700bcb10c0b8a9a61f0a5aa3367386cb5bc7e98118a4a875
sourceRefs:
- PLATFORM-DOC-03-02
- PLATFORM-DOC-04-01
- PLATFORM-IMPLEMENTATION-NAV
testPlanAuthoringOrder: 0
---

# ProFlow 测试总计划

## 1. 目标

在任何 Batch4 实现前冻结“规范必须证明什么”。测试不得让现有实现反向定义架构；若代码与规范冲突，先记 implementation gap，不修改 Owner/Contract 来迁就代码。

## 2. 当前架构基线

除原五领域 Frozen SDD 外，跨域测试必须读取：

- `PLATFORM-DOC-01-04`：J0→J6 Task Journey / Carrier / Observer 集成基线；
- `TASK-DOC-03-05`：Task Observer progression/diagnostic boundary；
- `AGENT-DOC-03-07`：Worker Turn 与 GPT Native boundary；
- `MODEL-DOC-03-08`：Task Diagnostic / System Assessment；
- Execution Browser Extension 最新 TECHNICAL-DESIGN；
- OpenAI Custom GPT official capability constraints 已被正式吸收的 File Bridge / Code Interpreter / Web Search / Always Allow / no custom header / no stable Action c-id 约束。

## 3. 统一测试层级

```text
Unit
→ Domain Behavior
→ Contract
→ Persistence / Adapter Real Integration
→ Module Integration
→ Module Conformance
→ Cross-domain Integration
→ Real E2E
→ Fault / Recovery
→ Performance / Stability
→ Evidence / Freeze
```

Mock/Unit/Conformance 均不能代替真实 Chrome/Custom GPT/File Bridge/Model/External Resource验收。

## 4. 第一版必须证明的跨域主线

```text
J0 3 generic Roles READY
→ J1 Extension create Task(PENDING) + 3 Workers one-time binding + Product Requirement
→ J2 human confirmation channel → startTask
→ J3 Task Observer → Carrier RESTORE/WAKE → Worker startNode
→ J4 one Worker Turn / 0..N Actions / native GPT capability
→ J5 owner facts → next/resume/reopen/recovery
→ J6 terminal → no ghost wake / archive refs retained
```

## 5. Observer 必测

### Task Observer

- 正常 progression deterministic；
- READY / Execution Result READY / Peer Reply READY / Reopen READY 能产生正确 typed wake/resume request；
- 不替 Worker `startNode`；
- 不写 Task/Execution/Collaboration；
- 只有单 Task ambiguity/UNKNOWN/repeated recovery/unexplained stall 才请求 REASON diagnostic；
- 模型结果没有 workflow authority。

### System Observer

- 8 类 bounded views；
- deterministic compact snapshot；
- concern batching；
- explicit carry-forward；
- targeted drill-down；
- cross-domain global synthesis；
- lowest priority / model busy defer；
- assessment 不覆盖 owner current facts。

## 6. OpenAI Native / Carrier 必测

- routine Action `x-openai-isConsequential:false` 与 Always Allow 主链；
- Execution dangerous Approval 仍独立；
- one wake → multi-action，不出现 action-level Browser scheduler；
- typed body/path/query identity，不依赖 arbitrary custom headers；
- Browser 提供/绑定 workerRef/c-id，Actions 不假设 stable Conversation id；
- File Bridge inbound/outbound、limits、relay、image asymmetry；
- Code Interpreter bounded Context Pack / Patch artifact path；
- public research Web Search vs Execution private/deterministic Network boundary；
- no frame registry/iframe team topology/persistent tab business identity。

## 7. Recovery / Idempotency 必测

所有真实 Effect：

```text
confirmed absent → retry
confirmed applied → reuse
uncertain → observe reality
still unknown → UNKNOWN, no blind replay
```

Worker CREATE partial success、WAKE submit disconnect、Collaboration physical delivery、Execution lost result、Chrome restart 都必须按该原则证明。

Reopen 与 Recovery 分开：Reopen same node/worker/conversation + runNo+1；技术 recovery 不改 Task business truth。

## 8. Approval 四分

测试必须明确互不混淆：

1. Task start confirmation channel；
2. Execution safety Approval fact；
3. Deployment ACTION_REQUIRED(_WEB) human action；
4. ChatGPT Action permission / Always Allow。

## 9. 开发中 TDD / Spec Change Gate

```text
Source Spec behavior
→ executable RED
→ minimal implementation
→ GREEN
→ refactor
```

如果正确测试无法由 Frozen Spec表达，或真实 evidence 与规范冲突：

```text
STOP
→ SPEC_GAP / CONTRACT_CONFLICT / EXTERNAL_BEHAVIOR_MISMATCH
```

不得先按当前代码写测试再修改规范来适配。

## 10. 全局 Freeze Gate

最终进入真实 E2E 前至少要求：

- 20 个 Module Test Plan 与本轮架构裁决无冲突；
- Provider/Consumer contract responsibility明确；
- all real effects有 duplicate/lost-result/UNKNOWN/recovery计划；
- Task/System Observer有独立 proof；
- Browser/Carrier没有 frame/business-store drift；
- Agent Packages使用 native GPT capability first；
- Model有 Task Diagnostic/System Assessment real-load验证路径；
- Deployment verify覆盖 GPT capabilities/Always Allow/Web-only reality；
- terminal no ghost wake；
- no unresolved P0/P1 architecture contradiction。

## 11. Evidence 原则

Business Fact、Evidence、Structured Log 必须分开。真实 PASS 必须包含 owner state/result/evidence或 external reality；HTTP 200、进程存活、Mock 成功都不能单独证明主链正确。

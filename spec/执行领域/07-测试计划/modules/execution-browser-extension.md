---
docId: TP-MODULE-EXECUTION-BROWSER-EXTENSION
title: execution-browser-extension｜开发前 Module Test Plan
docType: test-plan
authority: normative
lifecycle: active
domain: execution
subdomain: null
subdomains: []
boundedContext: execution
moduleRef: execution-browser-extension
provides: []
requires: []
contractRefs: []
testPlanPhase: PRE_IMPLEMENTATION
testPlanStatus: FINAL_FROZEN
sourceBaseline: ProFlow-ProFlow-DDD规范化技术文档-最终冻结基线-20260812.zip
sourceBaselineSha256: 69fdfbac8a5ee36b700bcb10c0b8a9a61f0a5aa3367386cb5bc7e98118a4a875
sourceRefs:
- EXECUTION-EXECUTION-BROWSER-EXTENSION-TECH-DESIGN
- EXECUTION-DOC-05-02
- AGENT-CROSS-DOMAIN-INTEGRATION-CHECKLIST
implementationWave: Wave 5
---

# `execution-browser-extension`｜开发前 Module Test Plan

## 1. Risk

该Module同时承载真实ChatGPT页面Effect与Extension application逻辑，最大风险是把transient browser reality升级为业务truth、重复submit，或把Task/System Observer做成新Scheduler/Owner。

## 2. Required Layers

- Unit / typed operation helpers
- Module Integration
- Cross-domain Integration
- Real Chrome + ChatGPT E2E
- Failure / Recovery
- Security / Boundary
- Concurrency / Idempotency

## 3. Critical Proofs

- [ ] **CP-EXE-BR-01** — `agentPackageRef/roleRef/workerRef/conversationLocator`稳定；tab/content transient；无frame/persistent-tab business identity。
- [ ] **CP-EXE-BR-02** — Extension New Task：Task(PENDING)后CREATE/observe/bind三Worker，Product可先工作，partial failure只补missing Worker。
- [ ] **CP-EXE-BR-03** — RESTORE/WAKE正确Conversation；`conversationLocator` 必须来自 TaskRoleBinding durable owner fact，禁止用 `roleRef + workerRef` 重构 URL；minimal wake；WAKE success仅physical delivery。
- [ ] **CP-EXE-BR-04** — Node READY→Task Observer wake→Worker formal `startNode`；Observer不写Task；production composition 由 Task mutation event 触发并在 process startup 做一次 bounded nonterminal recovery scan，不引入 platform-host timer/universal scheduler；同一 task/node/run/trigger 使用稳定 Execution idempotency identity。
- [ ] **CP-EXE-BR-05** — one Worker Turn支持0..N Actions；Browser无per-action “continue”或natural-language business parsing。
- [ ] **CP-EXE-BR-06** — routine Action Always Allow主链；unexpected permission prompt可恢复；Execution Approval独立。
- [ ] **CP-EXE-BR-07** — DOM-first page operation，异常结构才screenshot→Vision；Vision不直接成为Task/Execution success。
- [ ] **CP-EXE-BR-08** — Collaboration physical delivery durable/idempotent；`messageRef` 由 Agent pending owner surface 发现，ask/reply 事件触发 + process-start bounded recovery，不引入 platform-host timer/business queue；每个 message 使用稳定 Execution idempotency identity，只有 `SUCCEEDED + APPLIED + delivered=true` 才写 Agent logical DELIVERED；message/reply owner仍Agent。
- [ ] **CP-EXE-BR-09** — submit/WAKE effect uncertainty按DELIVERED/ABSENT/UNKNOWN reality reconciliation，无blind replay。
- [ ] **CP-EXE-BR-10** — Task Observer deterministic；first-run READY 与 reopened run 分别输出 `NODE_READY` / `REOPEN` typed trigger，并复用同一 durable TaskRoleBinding；异常REASON only diagnostic/no authority；terminal stop-driving。
- [ ] **CP-EXE-BR-11** — System Observer 8 bounded views + batching/carry-forward/drill-down/global synthesis，lowest priority/no owner mutation。
- [ ] **CP-EXE-BR-12** — ordinary file transport不经Browser DOM；File Bridge/Execution materialization主链可用，image→Vision fallback保留。

## 4. Failure Families

```text
duplicate CREATE
stale tab/content
wrong c-id / role mismatch
submit-after-disconnect unknown
Chrome restart locator restore
DOM drift
unexpected permission prompt
peer delivery lost
Task terminal ghost wake
Task Observer model used on normal READY
System Observer blocks business lane
System assessment attempts direct mutation
Browser file manager/frame registry reintroduced
```

## 5. Real / Fake Boundary

协议helper可fake Chrome API；以下必须真实Chrome+ChatGPT：c-id observation、Conversation CREATE/RESTORE/WAKE、DOM submit、Always Allow/permission behavior、multi-action Turn、reload/restart recovery。System Observer REASON需要真实手机模型负载验证；可用fixed snapshots做contract/unit测试但不能宣称real-load PASS。

## 6. Evidence

```text
Task owner snapshot before/after binding
workerRef/conversationLocator observation
Carrier typed operation result
wake intent / delivery evidence
same Conversation recovery trace
multi-action no-extra-wake trace
Collaboration delivery receipt
Vision fallback ref
Task Observer request trace
System assessment/batch/carry-forward/drill-down refs
UNKNOWN reconciliation record
```

## 7. GO / STOP

GO：上述Proof都能在Owner boundary下实现。  
STOP：必须靠frame/persistent tab/business store/Browser natural-language Task inference/Observer direct write才能通过。


## 2026-08-15 Pre-Smoke Batch 3｜Application / Observer / Carrier Closure Addendum

- [ ] **CP-EXE-BR-13** — Browser Reality Bridge 与 Browser Executor 形成正式 adapter composition，并通过 Task/Agent Owner transport 获取 durable binding/message facts；Browser package 不启动第二套 Execution Runtime。
- [ ] **RF-EXE-BR-13** — Browser package 自建第二个 Execution Runtime truth/process、绕过 Task/Agent owner transport、或把 Browser bridge readiness 冒充整个 Execution Runtime readiness。

**Batch boundary**：`execution-browser-extension` 在本批只交付 `Browser Reality Bridge ↔ Browser Executor` adapter/composition。**唯一正式 `execution-runtime` binary 注入 `browserExecutor`、并将该依赖纳入 runtime readiness，继续由既定 Batch 4 / P1-15 收口。** 这不是 Batch 3 缺失的新批次，也不得通过新增 alternate runtime binary 规避。

**Executable proof**：`packages/execution-browser-extension/tests/runtime-composition.test.ts`。


### Batch 3 executable proof mapping

| Frozen proof | Batch 3 executable/source proof | Current boundary |
|---|---|---|
| `CP-EXE-BR-02` New Task + 3 Worker | `packages/platform-host/tests/task-application-entry.test.ts` (`PRESMOKE-B3-APP-03`), `packages/execution-browser-extension/tests/side-panel-application.test.ts` | 真实 Chrome CREATE 仍属 Manual E2E；自动 proof 只证明 application orchestration/Owner boundary。 |
| `CP-EXE-BR-03` durable restore/wake | `packages/execution-browser-extension/tests/execution-browser-extension-critical-proofs.test.ts` | `conversationLocator` 为 Task Owner 真源；stale tab URL 不覆盖。 |
| `CP-EXE-BR-04` Task Observer lifecycle | `packages/execution-browser-extension/tests/task-observer-runtime.test.ts`, `packages/execution-browser-extension/tests/background-observer-application.test.ts` | Extension Background 拥有 lifecycle；Host 仅 transport/composition。 |
| `CP-EXE-BR-08` Collaboration Carrier | `packages/execution-browser-extension/tests/collaboration-carrier-application.test.ts`, `packages/execution-browser-extension/tests/background-observer-application.test.ts` | pending discovery 来自 Agent Owner；UNKNOWN durable hold；FAILED bounded retry。 |
| `CP-EXE-BR-09` no blind replay | `packages/execution-browser-extension/tests/collaboration-carrier-application.test.ts`, `packages/execution-browser-extension/tests/task-observer-runtime.test.ts` | deterministic wake intent + Execution idempotency；UNKNOWN 不自动重投。 |
| `CP-EXE-BR-10` Task Observer deterministic/diagnostic | `packages/execution-browser-extension/tests/task-observer-runtime.test.ts`, `packages/model-runtime/tests/observer-task-diagnostic-alignment.test.ts` | 正常路径零模型；异常只 diagnostic/no effect authority。 |
| `CP-EXE-BR-11` System Observer | `packages/execution-browser-extension/tests/system-observer-runtime.test.ts`, `packages/execution-browser-extension/tests/background-observer-application.test.ts`, `packages/model-runtime/tests/observer-system-assessment-alignment.test.ts` | 8-view batching/carry-forward/drill-down/global synthesis；service-worker restart 持久化 previous state。 |
| `CP-EXE-BR-13` Browser adapter composition | `packages/execution-browser-extension/tests/runtime-composition.test.ts` | Browser adapter 完成；**唯一 Execution Runtime binary 注入/readiness = Batch 4 / P1-15 carry-forward**。 |

**不得过度宣称**：上述自动 proof 不等于真实 Chrome / Custom GPT / physical Conversation E2E；真实页面 CREATE/RESTORE/WAKE/DOM submit/permission/extension reload 继续保留 `MANUAL_E2E_REQUIRED`。


### Batch 3 → Batch 4 explicit carry-forward

Batch 3 不通过越权补实现来强行关闭以下跨批依赖：

1. **Execution Approval controls**：Side Panel 已保留可见但 disabled 的 Approval 区域；Allow/Deny 只有在 Batch 4 / `P1-14` 建立 authoritative Approval Owner fact/store/lifecycle 后才能启用。Browser/UI 本批不得自建 approval state。
2. **Async Execution completion / UNKNOWN source → Task Observer**：Task Observer 已具备 typed `EXECUTION_RESULT_READY / RECOVERY_RESUME` 与 anomaly diagnostic contract，但正式 async Execution completion/recovery event source 属 Batch 4 `execution-runtime` composition/recovery；本批不得用同步 `executeCapability` completion 人工制造新 Worker Turn。
3. **Browser Executor → 唯一 execution-runtime binary**：Browser adapter 已完成，唯一 runtime 注入与 dependency-aware readiness 仍是 Batch 4 / `P1-15`。

因此 Batch 3 的最终报告必须区分“Browser/Observer 侧能力已实现”和“依赖 Batch 4 Execution Owner lifecycle 的最终 production signal/approval/runtime wiring”，不得把后者写成已关闭。

### 2026-08-16 Batch 4 recovery-signal closure

- The Batch 3 carry-forward for Execution recovery/UNKNOWN sourcing is now wired as an Execution-owned durable signal stream consumed by Extension Background during bounded startup/page-idle recovery. `RECOVERY_RESUME` drives the same durable TaskRoleBinding/Worker; `UNKNOWN_REALITY` enters advisory Task Diagnostic.
- Human Approval ALLOW/DENY/revoke is also a real Turn boundary: the durable Approval result resumes the bound Worker with `RECOVERY_RESUME` keyed by `approvalRef`. UI state itself is never the source of truth.
- Ordinary synchronous Action completion still does **not** create `EXECUTION_RESULT_READY`; no duplicate Worker Turn is manufactured.
- Signals are acknowledged only after Task Observer can action or terminally dispose of them; transient binding/target/diagnostic unavailability leaves the signal pending.

## Batch 4 Pre-Smoke Executable Proof Binding

> 本节只记录 Batch 3→4 carry-forward 的可执行证明；真实 Chrome / Custom GPT 仍属于最终人工 E2E。

| Carry-forward | Executable asset | Required behavior |
|---|---|---|
| Execution recovery/UNKNOWN signal source | `tests/background-observer-application.test.ts`<br>`../execution-runtime/tests/execution-runtime-critical-proofs.test.ts` | durable Runtime signal → Extension bounded recovery → Task Observer; transient unconsumable signal remains unacked |
| Human Approval Turn boundary | `tests/background-observer-application.test.ts` | owner-backed ALLOW/DENY/REVOKE response resumes the same durable Worker via `RECOVERY_RESUME`; UI stores no Approval truth |
| single formal runtime Browser injection | `../execution-runtime/tests/execution-runtime-service.test.ts` | shipped execution-runtime requires Browser composition; Browser package does not create a second Execution runtime |

普通同步 `executeCapability()` completion 仍不得制造额外 Browser Worker Turn。

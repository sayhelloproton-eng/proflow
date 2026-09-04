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
- [ ] **CP-EXE-BR-06** — routine ChatGPT Action Permission 由 Browser Carrier 在真实页面上识别并按 authoritative Role/target/operation/context 做分类；可信 mechanical gate 可自动 `Always Allow` 且必须验证 Turn 继续，unknown/untrusted 保持 BLOCKED/进入 Carrier Attention；Execution Approval 独立且不得复用。
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

协议helper可fake Chrome API；以下必须真实Chrome+ChatGPT：c-id observation、Conversation CREATE/RESTORE/WAKE、DOM submit、Always Allow/permission behavior、multi-action Turn、Chrome restart recovery。System Observer REASON需要真实手机模型负载验证；可用fixed snapshots做contract/unit测试但不能宣称real-load PASS。

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
- [ ] **CP-EXE-BR-14** — Browser Carrier / Collaboration Carrier / Task+System Observer 通过 authenticated local `/application/log` 提交 bounded structured logs，覆盖 execution/task/node/run/role/worker/correlation/capability/operationRef/tab 等关联轴；日志只含 refs/status/errorCode 等机器事实，不含 Authorization/credential/full prompt/reply/file/screenshot bytes。
- [ ] **RF-EXE-BR-13** — Browser package 自建第二个 Execution Runtime truth/process、绕过 Task/Agent owner transport、或把 Browser bridge readiness 冒充整个 Execution Runtime readiness。

**Batch boundary**：`execution-browser-extension` 在本批只交付 `Browser Reality Bridge ↔ Browser Executor` adapter/composition。**唯一正式 `execution-runtime` binary 注入 `browserExecutor`、并将该依赖纳入 runtime readiness，继续由既定 Batch 4 / P1-15 收口。** 这不是 Batch 3 缺失的新批次，也不得通过新增 alternate runtime binary 规避。

**Executable proof**：`packages/execution-browser-extension/tests/runtime-composition.test.ts`。


### Batch 3 executable proof mapping

| Frozen proof | Batch 3 executable/source proof | Current boundary |
|---|---|---|
| `CP-EXE-BR-02` New Task + 3 Worker | `packages/platform-host/tests/task-application-entry.test.ts` (`R2-P1-18-APP-03 Product binds durably while Dev/Test are held; recovery fills only missing Workers`), `packages/execution-browser-extension/tests/side-panel-application.test.ts` | 真实 Chrome CREATE 仍属 Manual E2E；自动 proof 只证明 application orchestration/Owner boundary。 |
| `CP-EXE-BR-03` durable restore/wake | `packages/execution-browser-extension/tests/execution-browser-extension-critical-proofs.test.ts` | `conversationLocator` 为 Task Owner 真源；stale tab URL 不覆盖。 |
| `CP-EXE-BR-04` Task Observer lifecycle | `packages/execution-browser-extension/tests/task-observer-runtime.test.ts`, `packages/execution-browser-extension/tests/background-observer-application.test.ts`, `packages/platform-host/tests/task-application-entry.test.ts` (`CP-EXE-BR-04 Observer application rejects an unconfirmed wake Execution`) | Extension Background 拥有 lifecycle；Host 仅 transport/composition；WAKE Execution 非 `SUCCEEDED + APPLIED` 时 transport fail-closed。 |
| `CP-EXE-BR-08` Collaboration Carrier | `packages/execution-browser-extension/tests/collaboration-carrier-application.test.ts`, `packages/execution-browser-extension/tests/background-observer-application.test.ts` | pending discovery 来自 Agent Owner；UNKNOWN durable hold；FAILED bounded retry。 |
| `CP-EXE-BR-09` no blind replay | `packages/execution-browser-extension/tests/collaboration-carrier-application.test.ts`, `packages/execution-browser-extension/tests/task-observer-runtime.test.ts`, `packages/execution-browser-extension/tests/background-observer-application.test.ts` (`CP-EXE-BR-09 bounded recovery retries rejected wake delivery without bypassing Execution idempotency`) | deterministic wake intent + Execution idempotency；bounded recovery 复用稳定 identity，UNKNOWN 不自动重投。 |
| `CP-EXE-BR-10` Task Observer deterministic/diagnostic | `packages/execution-browser-extension/tests/task-observer-runtime.test.ts`, `packages/model-runtime/tests/observer-task-diagnostic-alignment.test.ts` | 正常路径零模型；异常只 diagnostic/no effect authority。 |
| `CP-EXE-BR-11` System Observer | `packages/execution-browser-extension/tests/system-observer-runtime.test.ts`, `packages/execution-browser-extension/tests/background-observer-application.test.ts`, `packages/model-runtime/tests/observer-system-assessment-alignment.test.ts` | 8-view batching/carry-forward/drill-down/global synthesis；service-worker restart 持久化 previous state。 |
| `CP-EXE-BR-13` Browser adapter composition | `packages/execution-browser-extension/tests/runtime-composition.test.ts` | Browser adapter 完成；Platform Host / Bridge credential 仅从 secret file 读取，POSIX 下 group/world-readable secret fail-closed；**唯一 Execution Runtime binary 注入/readiness = Batch 4 / P1-15 carry-forward**。 |

**不得过度宣称**：上述自动 proof 不等于真实 Chrome / Custom GPT / physical Conversation E2E；真实页面 CREATE/RESTORE/WAKE/DOM submit/permission 继续保留 `MANUAL_E2E_REQUIRED`。


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


## 2026-08-23 Real-2｜Deployment Provisioning Addendum

本增量只覆盖 `/gpts/editor/*` 部署分支；既有 `/g/*` Task/Worker Browser Carrier CP/RF 原样保留。

- [ ] **CP-EXE-BR-15** — Extension manifest/content routing 能让 Deployment Provisioning 独立覆盖 `/gpts/editor/*`，且运行期 `/g/*` script/command/state machine 不被复用或污染。
- [ ] **CP-EXE-BR-16** — setup 使用真实 authenticated hello/heartbeat 判断 extension online；用户只负责加载 unpacked extension，machine-owned extension/session reality 不要求用户手抄证明。
- [ ] **CP-EXE-BR-17** — `CustomGptEditorDriver` 使用 deterministic semantic/DOM selector + readback，完成字段、Knowledge、model/capabilities、Action Schema、private create/update；不使用固定坐标或模型自由决策。
- [ ] **CP-EXE-BR-18** — Provisioning file transport 与 command JSON 分离；只接受 Mac 侧已安全 staging 的 bounded files，Knowledge upload 等待真实 processing completion。
- [ ] **CP-EXE-BR-19** — role credential 仅作为 ephemeral Auth material 输入；Extension 不生成、不持久化、不记录；Auth update 后 secret buffer/reference 被清除。
- [ ] **CP-EXE-BR-20** — editor close/reopen、CLI retry 后按 live GPT/Role reality 恢复，只补 missing/drift，禁止 duplicate GPT。

- [ ] **RF-EXE-BR-14** — Provisioning DTO/代码依赖 Task Observer、worker binding、Execution Record 或 runtime Browser Effect state machine。
- [ ] **RF-EXE-BR-15** — selector/DOM mismatch 后坐标猜测、Vision/model 自由点击或把 UNKNOWN 当成功。
- [ ] **RF-EXE-BR-16** — Knowledge bytes 走大 JSON/base64 command、未做 Mac staging 安全校验，或 Extension 获得任意本地路径读取能力。
- [ ] **RF-EXE-BR-17** — credential 泄漏到 `chrome.storage`、runtime config、log、Evidence、snapshot 或错误对象。
- [ ] **RF-EXE-BR-18** — Provisioning 变更导致现有 J1-J6 Browser/Observer/Collaboration executable regression。

跨域完整验收统一服从 [`TP-REAL2-CUSTOM-GPT-DEPLOYMENT-PROVISIONING`](../../../智能体运行与协作领域/07-测试计划/REAL2-Custom-GPT-Deployment-Provisioning.md)。

## 2026-09-04 Real-3｜Browser Carrier Reality Hardening Addendum

本增量来自真实 Chrome/ChatGPT 路径证据，不重开 Deployment、不改变 Task/Agent/Execution Owner。长期结构冻结为四条 application line（Deployment / Workflow / Collaboration / System Observer）共享一个 Browser Carrier；本节只加固共享 Carrier 的真实页面最后一公里。

- [ ] **CP-EXE-BR-21** — controlled composer 必须按 `WRITE → COMMIT → READY → CLICK → REALITY` 提交；确定性 delayed-state fixture 能复现旧“一拍错位/shared draft”行为，并证明修复后连续 Product/Dev/Test 文本无前一角色串线。禁止固定 sleep 作为 commit 条件。
- [ ] **CP-EXE-BR-22** — 当前 ChatGPT Action Permission 即使没有 `[role=dialog]` 也必须由 semantic detector 识别为 `BLOCKED + ACTION_PERMISSION`；composer 同时存在不能把 blocker 误判成 IDLE。selector/button 文案只是 detector 实现细节，不是 contract。
- [ ] **CP-EXE-BR-23** — blocker strategy registry 可扩展；trusted current ProFlow Role + 当前 Agent Gateway producer shared fact target + Role-authorized operation + matching context 才能 `AUTO_ALLOW`，其余 `HUMAN_REQUIRED/UNKNOWN`。role-carrier validation 的 target 必须与当前 Provider fact 一致；fact 缺失或已漂移时 fail closed。context 必须含 non-null 且完全一致的 Task binding `workerRef + conversationLocator`，不能把未绑定 Role 或仅匹配 Role 首页当成 current Worker。相同“始终允许”按钮出现在未知 connector/operation 时绝不自动点击；`x-openai-isConsequential:false` 不能单独放行。
- [ ] **CP-EXE-BR-24** — Permission actuator 只能执行 typed semantic action（`allowAlways/allowOnce/deny`），点击前复验 `tab/contentInstanceId/URL/permissionFingerprint`；stale 时 fail-closed。AUTO_ALLOW 前先持久化 transient uncertain-attempt，MV3 background restart 不得重放未确认 click；AUTO_ALLOW 后必须重新观察同一 prompt 已消失或 Action/Turn 已继续才清除 attempt，不能以 `.click()` 返回作为成功。已确认释放后，相同 routine permission 的下一次真实 occurrence 仍可重新分类处理。
- [ ] **CP-EXE-BR-25** — Workflow、Collaboration、Task Observer、System Observer 不感知具体 ChatGPT blocker case。`BLOCKED/UNKNOWN` 不触发 page-idle Task recovery；只有真实 normalized transition 到 IDLE 或明确 durable resume signal 才可继续。
- [ ] **CP-EXE-BR-26** — ChatGPT Carrier Permission 与 Workflow/Execution Approval 两层严格分离；mechanical permission/Carrier Attention 不写 `execution_approvals`，Carrier auto-grant 不能绕过 Execution Policy/Approval Owner。
- [ ] **CP-EXE-BR-27** — Content Script 保持薄 adapter：只做 reality extraction、composer/semantic DOM action、message reality verification；trust classification/strategy orchestration 不沉入 DOM layer，`background.ts` 不增加 case-specific selector/button if/else。

- [ ] **RF-EXE-BR-19** — arbitrary sleep 后直接 click Send，或只验证 send-button 存在不验证 controlled composer readback。
- [ ] **RF-EXE-BR-20** — 把 `[role=dialog]` 作为唯一 Permission contract，或因为 composer 可见把当前 permission 页面判为 IDLE。
- [ ] **RF-EXE-BR-21** — generic click 任意“始终允许”、Extension 自建漂移 operation allowlist、模型输出覆盖 Role/target/fingerprint 硬约束。
- [ ] **RF-EXE-BR-22** — 在 Workflow/Collaboration/Observer 主线为 `getTask`/OAuth/未来 blocker 写专用分支，或把 Carrier Attention 伪装成 Execution Approval。
- [ ] **RF-EXE-BR-23** — Permission/submit command 在 stale content/session/URL/fingerprint 上继续执行，或 UNKNOWN 后盲重放。

**Executable-first mapping**：

| Proof | Required executable asset | Reality boundary |
|---|---|---|
| CP-21 | `tests/chatgpt-composer.test.ts` | controlled-state fixture 先 RED 后 GREEN；最终仍需真实 ChatGPT submit 证明。 |
| CP-22/23/24 | `tests/chatgpt-carrier-permission.test.ts` | 使用来自真实 current DOM 语义的 fixture；AUTO_ALLOW/HUMAN_REQUIRED/stale lifecycle 可自动 proof，真实按钮行为仍需 Chrome E2E。 |
| CP-25 | `tests/recovery-trigger.test.ts` + Carrier integration test | BLOCKED 不触发 recovery；permission 解除后真实 IDLE transition 才触发。 |
| CP-26/27 | boundary/source tests + platform-host permission-classification test | 证明 policy 使用 authoritative Role operation inventory，Content/Workflow/Collaboration 无 case-specific trust logic。 |

**Real Chrome gate**：最终必须在固定 Real-3 Task/Role 资源上证明正确 `WORKER_BIND` 无一拍错位、routine `getTask` permission 零人工处理、Conversation/Task binding reality 一致且不新增 UNKNOWN；controlled human-anomaly path 可用受控 fixture/模拟验证，不制造真实危险副作用。

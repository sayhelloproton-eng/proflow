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

该Module同时承载真实 ChatGPT Browser Effect、System Observer 页面能力与独立 Local Tool Effect Gate。最大风险是把 transient browser reality 升级为业务 truth、重复 submit，或让 Local Tool lane 污染 Browser heartbeat/WAKE/permission hot path。Task progression 已由 backend Observer/Reconciliation 负责。

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
- [ ] **CP-EXE-BR-04** — Node READY→backend Task Observer/Reconciliation→Extension Carrier WAKE→Worker formal `startNode`；Extension 不做 progression detection/catch-up，只执行 typed Carrier dispatch，并保留同一 task/node/run/trigger 的 Browser Effect idempotency/reality guard。
- [ ] **CP-EXE-BR-05** — one Worker Turn支持0..N Actions；Browser无per-action “continue”或natural-language business parsing。
- [ ] **CP-EXE-BR-06** — routine ChatGPT Action Permission 由 Browser Carrier 在真实页面上识别并按 authoritative Role/target/operation/context 做分类；可信 mechanical gate 可自动 `Always Allow` 且必须验证 Turn 继续，unknown/untrusted 保持 BLOCKED/进入 Carrier Attention；Execution Approval 独立且不得复用。
- [ ] **CP-EXE-BR-07** — DOM-first page operation，异常结构才screenshot→Vision；Vision不直接成为Task/Execution success。
- [ ] **CP-EXE-BR-08** — Collaboration physical delivery durable/idempotent；`messageRef` 由 Agent pending owner surface 发现，ask/reply 事件触发 + process-start bounded recovery，不引入 platform-host timer/business queue；每个 message 使用稳定 Execution idempotency identity，只有 `SUCCEEDED + APPLIED + delivered=true` 才写 Agent logical DELIVERED；message/reply owner仍Agent。
- [ ] **CP-EXE-BR-09** — submit/WAKE effect uncertainty按DELIVERED/ABSENT/UNKNOWN reality reconciliation，无blind replay。
- [ ] **CP-EXE-BR-10** — Extension 对 backend 发来的 `NODE_READY/REOPEN/RECOVERY_RESUME` typed Carrier request 只做 target/binding/permission/reality guard 与 physical dispatch；不在 service worker 自行计算 Task next-step；terminal/stale request fail-closed。
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
| `CP-EXE-BR-04` Carrier delivery boundary | Extension Carrier tests + backend reconciliation tests（代码变更后按真实实现重绑 exact executable asset） | backend Task Observer/Reconciliation 拥有 deterministic progression/catch-up；Extension 只消费 typed Carrier request 并做 restore/permission/submit/receipt/reality guard。 |
| `CP-EXE-BR-08` Collaboration Carrier | `packages/execution-browser-extension/tests/collaboration-carrier-application.test.ts`, `packages/execution-browser-extension/tests/background-observer-application.test.ts` | pending discovery 来自 Agent Owner；UNKNOWN durable hold；FAILED bounded retry。 |
| `CP-EXE-BR-09` no blind replay | `packages/execution-browser-extension/tests/collaboration-carrier-application.test.ts`, `packages/execution-browser-extension/tests/task-observer-runtime.test.ts`, `packages/execution-browser-extension/tests/background-observer-application.test.ts` (`CP-EXE-BR-09 bounded recovery retries rejected wake delivery without bypassing Execution idempotency`) | deterministic wake intent + Execution idempotency；bounded recovery 复用稳定 identity，UNKNOWN 不自动重投。 |
| `CP-EXE-BR-10` typed Carrier request / diagnostic isolation | Extension Carrier tests + backend Task Observer/Reconciliation tests + model diagnostic tests（代码变更后重绑 exact asset） | progression decision 不在 Extension；异常 REASON 只 diagnostic/no authority，System Observer/diagnostic 不占 progression lock。 |
| `CP-EXE-BR-11` System Observer | `packages/execution-browser-extension/tests/system-observer-runtime.test.ts`, `packages/execution-browser-extension/tests/background-observer-application.test.ts`, `packages/model-runtime/tests/observer-system-assessment-alignment.test.ts` | 8-view batching/carry-forward/drill-down/global synthesis；service-worker restart 持久化 previous state。 |
| `CP-EXE-BR-13` Browser adapter composition | `packages/execution-browser-extension/tests/runtime-composition.test.ts` | Browser adapter 完成；Platform Host / Bridge credential 仅从 secret file 读取，POSIX 下 group/world-readable secret fail-closed；**唯一 Execution Runtime binary 注入/readiness = Batch 4 / P1-15 carry-forward**。 |

**不得过度宣称**：上述自动 proof 不等于真实 Chrome / Custom GPT / physical Conversation E2E；真实页面 CREATE/RESTORE/WAKE/DOM submit/permission 继续保留 `MANUAL_E2E_REQUIRED`。


### Batch 3 → Batch 4 explicit carry-forward

Batch 3 不通过越权补实现来强行关闭以下跨批依赖：

1. **Execution Approval controls**：Side Panel 已保留可见但 disabled 的 Approval 区域；Allow/Deny 只有在 Batch 4 / `P1-14` 建立 authoritative Approval Owner fact/store/lifecycle 后才能启用。Browser/UI 本批不得自建 approval state。
2. **Async Execution completion / UNKNOWN source → backend Reconciliation**：Execution Runtime 可以发布 durable `RECOVERY_RESUME / UNKNOWN_REALITY` 等 current facts/signals；backend Task Observer/Reconciliation 消费这些事实并决定是否形成 typed Carrier request。Extension 不消费 Execution signal 来自行计算 Task next-step；同步 internal `executeCapability` completion 也不得人工制造新 Worker Turn。
3. **Browser Executor → 唯一 execution-runtime binary**：Browser adapter 已完成，唯一 runtime 注入与 dependency-aware readiness 仍是 Batch 4 / `P1-15`。

因此 Batch 3 的最终报告必须区分“Browser/Observer 侧能力已实现”和“依赖 Batch 4 Execution Owner lifecycle 的最终 production signal/approval/runtime wiring”，不得把后者写成已关闭。

### 2026-08-16 Batch 4 recovery-signal closure

- Execution recovery/UNKNOWN 仍由 Execution Owner 产生 durable signal/current fact，但消费与 next-step decision 归 backend Task Observer/Reconciliation；Extension Background 只接收最终 typed Carrier request。`RECOVERY_RESUME` 继续指向同一 durable TaskRoleBinding/Worker；`UNKNOWN_REALITY` 只进入 advisory diagnostic。
- Human Approval ALLOW/DENY/revoke is also a real Turn boundary: the durable Approval result resumes the bound Worker with `RECOVERY_RESUME` keyed by `approvalRef`. UI state itself is never the source of truth.
- Ordinary synchronous Action completion still does **not** create `EXECUTION_RESULT_READY`; no duplicate Worker Turn is manufactured.
- Signals 只有在 backend Task Observer/Reconciliation 已形成 actionable/terminal decision 后才可 acknowledge；transient binding/target/diagnostic unavailability 必须保持 pending，Extension 不拥有该 acknowledgement 决策。

## Batch 4 Pre-Smoke Executable Proof Binding

> 本节只记录 Batch 3→4 carry-forward 的可执行证明；真实 Chrome / Custom GPT 仍属于最终人工 E2E。

| Carry-forward | Executable asset | Required behavior |
|---|---|---|
| Execution recovery/UNKNOWN signal source | backend reconciliation tests + `../execution-runtime/tests/execution-runtime-critical-proofs.test.ts`（代码变更后重绑 exact asset） | durable Runtime signal/current fact → backend Reconciliation → typed Carrier request；Extension 不做 progression decision，transient unconsumable signal remains unacked |
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

## 2026-09-04 Real-3｜Browser Carrier Lifecycle Closure Addendum

- [ ] **CP-EXE-BR-28** — 已验证 current Role/Gateway/operation/Worker URL 且同 Task/Role binding 已存在、但 `workerRef + conversationLocator` 同时为空时返回 `DEFER`；同 fingerprint bounded reclassify 后只可精确 binding→AUTO_ALLOW，timeout/conflict/missing/partial binding→HUMAN_REQUIRED，全程零提前 click/Attention。
- [ ] **CP-EXE-BR-29** — `allowOnce` 保留普通 `BLOCKED → IDLE` recovery；`deny` 在 action 前持久化 current occurrence continuation denial，只抑制下一次 matching recovery，其他 tab/Worker 不受影响，且不写 Task/Execution/Approval。
- [ ] **CP-EXE-BR-30** — MV3 初始化/startup/install 主动 query 现存 `https://chatgpt.com/g/*` 并向 Content Script 请求只读 snapshot，重建 Attention；uncertain automatic attempt restore 后不重复 click，不依赖后续 DOM Mutation。
- [ ] **CP-EXE-BR-31** — Attention ref 按 occurrence 唯一；同 occurrence 重观察复用 ref，release 后相同 tab+fingerprint 得新 ref，content replacement 立即使旧 action stale。
- [ ] **CP-EXE-BR-32** — primary `/tasks` 从 authenticated Bridge 读取 bounded Attention mirror，并以 cookie session + exact origin + current ref/action 验证后 relay 到 Extension；wrong origin/no session/stale ref 拒绝，Extension-owned Tasks fallback 保留。

- [ ] **RF-EXE-BR-24** — 以 Role 首页、缺失 binding、部分 binding 或冲突 binding 进入 DEFER/AUTO_ALLOW，或 DEFER 期间 click/提前 Attention。
- [ ] **RF-EXE-BR-25** — 人工 deny 后 page-idle recovery 自动 WAKE/RESUME 同一 continuation，或 suppression 污染其他 Worker/永久关闭后续 occurrence。
- [ ] **RF-EXE-BR-26** — restart 仅等待 Mutation、按旧 Attention ref 操作 replacement content，或因重观察重复 permission click。
- [ ] **RF-EXE-BR-27** — loopback `/tasks` 暴露 owner/bridge token、绕过 Extension 执行、接受 cross-origin/no-session/stale Attention action。

**Executable-first mapping**：

| Proof | Required executable asset | Boundary |
|---|---|---|
| CP-28 | `tests/permission-binding-race.test.ts` + `platform-host/tests/browser-permission-policy.test.ts` | pure policy/lifecycle；真实 binding race 仍由 Real Chrome gate 证明。 |
| CP-29 | `tests/carrier-human-deny-recovery.test.ts` | occurrence-scoped control、session restore 与 Background wiring；不制造真实 deny。 |
| CP-30/31 | `tests/carrier-attention-restart.test.ts` + `tests/carrier-permission-attempt.test.ts` | 主动 snapshot wiring、occurrence identity 与 no-replay persistence。 |
| CP-32 | `tests/carrier-attention-web-bridge.test.ts` | real loopback HTTP/auth/command relay；Extension command result 为 controlled fixture。 |

本 Addendum 的 automated PASS 仍不等于 Real-3 J1 PASS；不得据此声称三 Worker 已在真实 Chrome 中创建或绑定。

### Human Deny final guard invariant

- [ ] **CP-EXE-BR-33** — deny 已持久化且同一 BLOCKED permission 在 MV3 restart 后仍存在时，即使 authoritative policy 已可 `AUTO_ALLOW`，permission lifecycle 仍在 classify/reclassify/action 前返回 `HUMAN_DENIED`，零 `allowAlways/allowOnce/automatic click`，并重建 human-visible Attention。
- [ ] **CP-EXE-BR-34** — page-idle、startup、scheduled retry、Task application event 与 durable `RECOVERY_RESUME` 的 WAKE/RESUME 在实际 Carrier dispatch 前均受 matching `taskId/roleRef/workerRef/conversationLocator` denial guard；Task Observer 不包含 Permission case logic。
- [ ] **CP-EXE-BR-35** — denial 被真实 matching IDLE reality 消费后，同 fingerprint 的新 occurrence 使用新 occurrenceRef，并可重新进入正常 trusted AUTO_ALLOW；Deny 不形成永久 blacklist。
- [ ] **RF-EXE-BR-28** — restart 的 BLOCKED re-observe 先执行 routine auto strategy、或任何 Observer 入口直接 dispatch 而绕过 active human denial。

**Executable proof**：`tests/carrier-human-deny-lifecycle.test.ts`（restart + same BLOCKED、trusted context 不覆盖 Deny、全部 Observer dispatch 最后 guard、消费后未来 occurrence 可正常 AUTO_ALLOW）。真实 Chrome/Deny 行为仍保留在人工 E2E gate。

## 2026-09-09 Real-3｜Local Tool 独立 Lane Gate

- [ ] **CP-EXE-BR-36** — Local Tool 只使用 `/v1/local-tools/commands/* + runLocalToolBridgeLoop()`；现有 `/v1/commands/* + runBridgeLoop()` Browser lane 行为保持不变。
- [ ] **CP-EXE-BR-37** — 两条 lane 不共享 queue、pending map、serial loop、timeout/backoff、dispatcher、readiness、locks、tab/content/page session 或 Observer state。
- [ ] **CP-EXE-BR-38** — `Local Dev.run/process` 长命令、provider hang、timeout 或大输出不会阻塞 Browser heartbeat、permission handling、WAKE、submit、Collaboration delivery。
- [ ] **CP-EXE-BR-39** — Local Tool lane 只接受 Host 已 admission 的 typed Tool command；不读取 Task/Node/Worker/Execution identity，不 import Task Observer/System Observer/Collaboration/DOM adapter。
- [ ] **CP-EXE-BR-40** — Local Tool mutation timeout/uncertain result 返回 typed UNKNOWN/uncertain outcome，Extension 不 blind replay；后续由同 Tool 的 reality operation重新观察。
- [ ] **CP-EXE-BR-41** — Browser Reality/Local Tool bridge runtime 由 `execution-browser-extension` 模块独立启动/停止并发布 endpoint/credential/readiness；停止 `execution-runtime` 后 Extension session 与 Local Tool lane 仍保持可用，Execution Runtime 仅作为 Browser lane client。
- [ ] **CP-EXE-BR-42** — Module dependency graph 与运行时方向一致：Browser Extension descriptor 不 `requires execution`，提供 `execution-browser-executor + local-tool-bridge`；Execution Runtime 依赖前者，platform-host 依赖后者；dependency graph 无 cycle/hidden reverse dependency。
- [ ] **RF-EXE-BR-29** — 把 Local Tool case 塞进 `runBridgeLoop()/executeCommand()` 或共享 Browser pending/lock，导致 Browser hot path 被工具吞吐拖慢。
- [ ] **RF-EXE-BR-30** — bridge lifecycle 仍绑在 `execution-runtime` formal process，导致 Execution Runtime stop/restart 顺带让 Direct Local Tools DOWN。

本 Addendum 暂不修改现有 executable tests/`08-测试用例与验证`；代码完成后再按真实目录与测试名重绑。

## 独立审计补充：双 Lane 与 lifecycle 的真实验证

细化现有 Local Tool / isolation proofs；exact testcase/evidence binding 在实现后更新。

1. 同时运行真实 Local Dev 长 process、Repomix pack / CodeGraph indexing 与 Browser heartbeat/WAKE/submit；另用同步 CPU block 和永不返回的 Provider child 注入故障，证明 control plane 仍调度。异步 sleep fake 不能证明事件循环隔离。
2. 记录 Browser heartbeat 最大间隔及 command-consumer freshness，全程不跨配置失活阈值；每次 WAKE 以真实 user-message fingerprint 确认，不能只用 HTTP 200。记录 idle baseline 与负载下 p50/p95、超时数和总调用数，禁止在未测时声称吞吐提升倍数。
3. 停 execution-runtime 后 Bridge listener/generation、Extension Local Tool consumer、真实 read 持续工作；restart execution 不创建第二 listener、不旋转另一 lane credential、不清空另一 lane pending map。
4. Host enqueue token 调 execute、Browser token 调 Local Tool execute、重放旧 generation、换参、过期排队 command 均拒绝；断开 Extension 后 Host 不能使真实文件发生 mutation。
5. Browser lane 超时/backoff 不使 local consumer DOWN；Local Tool child timeout/crash 不改变 Browser readiness。Extension 整体卸载同时失去两 lane 作为预期共同故障，不能标为 lane isolation defect。
6. bridge stop 与 start 交错、失败构造后 cleanup、old generation late result 都不能关闭新 listener 或完成新请求；已 dispatch uncertain mutation 保持 UNKNOWN，禁止 restart 自动重放。

长期 process 必须先返回 processRef；断开 result 后以文件/hash/process/port reality 观察，不能把 process 消失判成全部副作用未发生。

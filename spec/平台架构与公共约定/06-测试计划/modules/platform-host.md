---
docId: TP-MODULE-PLATFORM-HOST
title: platform-host｜开发前 Module Test Plan
docType: test-plan
authority: normative
lifecycle: active
domain: platform
subdomain: null
subdomains: []
boundedContext: null
moduleRef: platform-host
provides: []
requires: []
contractRefs: []
testPlanPhase: PRE_IMPLEMENTATION
testPlanStatus: FINAL_FROZEN
sourceRefs:
- PLATFORM-HOST-TECH-DESIGN
- PLATFORM-HOST-SERVICE-RUNTIME
- PLATFORM-HOST-COMPOSITION-ROOT
- PLATFORM-DOC-03-02
implementationWave: Wave 6
---

# `platform-host` 开发前 Module Test Plan

> `platform-host` 只证明 composition root / local transport / lifecycle / failure isolation，不证明 Domain业务、Browser Carrier或Observer reasoning本身。

## 1. Source of Truth

- `PLATFORM-HOST-TECH-DESIGN`
- `PLATFORM-HOST-SERVICE-RUNTIME`
- `PLATFORM-HOST-COMPOSITION-ROOT`
- `PLATFORM-DOC-01-04`

## 2. 风险

最大风险是 host 吸收：

```text
业务状态
统一 Scheduler
Task workflow ownership / System assessment truth
Browser operation
cross-domain mutable cache
```

从而重新形成“大核心”。

## 3. Required Layers

- Unit
- Module Integration
- Cross-Domain Integration
- Process Lifecycle
- Failure / Recovery
- Architecture Boundary

Persistence/Real External E2E不属于host自身；真实外部链由相应Owner/Adapter证明。

## 4. Critical Proofs

- [ ] **CP-HOST-01** — 装配独立 Task/Agent packages、内部 Execution/Model clients、Direct Tool admission/router 与 backend Task Observer/Reconciliation；不复制 Owner state。
- [ ] **CP-HOST-02** — Domain package不反向依赖host；host无业务Repository/state mirror，且 GPT Tool route 无 fs/git/process/shell/Repomix/CodeGraph executor 调用；自身配置、日志与 Owner persistence 不算 bypass。
- [ ] **CP-HOST-03** — local transport/startup/shutdown/drain可重复；Task/Peer request保持 owner typed fields，Direct Tool request只允许 `operation + input`。
- [ ] **CP-HOST-04** — readiness 按 operation/provider 隔离：Repomix/Local Dev/CodeGraph 可在无关 Model/Execution DOWN 时继续服务；host 不发明 Domain READY。
- [ ] **CP-HOST-05** — restart重建graph并re-read owner reality；Task Reconciliation bounded catch-up 可重新发现 READY/RESUME，不 replay mutation。
- [ ] **CP-HOST-06** — backend Task Observer/Reconciliation deterministic progression + bounded catch-up 不依赖 Extension service-worker 存活；System Observer reasoning 与 progression single-flight/lock隔离。
- [ ] **CP-HOST-07** — Direct Tool admission 固定 `authenticated Role × Tool × Operation × server-bound workspace/provider config`，随后只向 Extension Local Tool lane 投递；无 Host direct local execution、无 universal scheduler/event bus、无 Browser DOM/frame/tab registry。

## 5. Failure Families

- host吸收Task/Agent/Execution business persistence；
- dependency unavailable被改写为业务状态；
- restart从host cache恢复owner facts；
- Task Reconciliation 退化为依赖 Extension event 的单点触发，或 bounded catch-up 缺失；
- System Observer assessment被host当truth或占用 progression lock；
- host绕过 Extension 直接执行 fs/git/process/shell/Repomix/CodeGraph；
- unrelated Model/Execution outage 把 Direct Tool readiness 一并拉红。

## 6. Evidence

```text
package/dependency graph
DI wiring
local transport trace
startup/shutdown order
health result
restart before/after owner facts
filesystem/store inspection proving no business persistence
observer consumer public-client wiring
architecture import/dependency gate
```

## 7. GO / STOP

GO：上述Proof均可在不改变Owner Contract下表达。  
STOP：必须新增host-owned state/scheduler/Observer authority/Browser runtime才能实现。

## 2026-08-15 Pre-Smoke Batch 2｜Agent Operations / Collaboration Composition Addendum

- [ ] **CP-HOST-08** — platform-host 提供 loopback-only、独立 0600 management credential 保护的 Agent management composition；Role Package CLI 不直接持有 Task/Agent persistence ownership。
- [ ] **CP-HOST-09** — platform-host 仅保持 Collaboration 的 owner-port/composition 边界：不创建 Collaboration business scheduler/timer，不替 Extension Carrier 驱动物理投递，也不把 Agent pending message 自动 replay 成 Execution effect；真实 pending→Carrier→Execution→delivery report 主链由 `execution-browser-extension` 在其正式 Carrier lifecycle 中完成。
- [ ] **CP-HOST-10** — Product / Controller-Dev / Test-Ops 三份 shipped canonical OpenAPI operation inventory 与 platform-host internal role ACL 逐项完全一致；Test/Ops `startNode` 包含在该精确集合中。
- [ ] **RF-HOST-08** — management 无认证、CLI 直读 Task DB、或 Role delete 绕过 Task usage owner port。
- [ ] **RF-HOST-09** — platform-host 出现 Collaboration timer/scheduler、以内部 caller 自动重放 pending message、拥有 Browser delivery truth，或绕过 Agent/Execution/Extension Owner boundary。
- [ ] **RF-HOST-10** — 任一 shipped Role OpenAPI operation inventory 与 Host ACL 出现新增、缺失或 owner authority 漂移。

**Executable proof**：`packages/platform-host/tests/presmoke-batch2-agent-collaboration.test.ts`。

## 2026-08-15 Pre-Smoke Batch 3｜Browser Application / Observer / Carrier Addendum

- [ ] **CP-HOST-11** — Extension Task Application 通过 authenticated loopback composition 实际完成 `Task.create(PENDING) → 固定三 Role Worker 经 Execution 创建并回写 TaskRoleBinding → Task READY → Task.start(ACTIVE)`；UI/host 均不复制 Task readiness/state-machine truth。
- [ ] **RF-HOST-11** — Worker 创建绕过 Execution、UI/host 直接写 Task binding/readiness、缺失 binding 被假定成功、或通过第二套 Task Store 完成 J1。

**Executable proof**：`packages/platform-host/tests/task-application-entry.test.ts` 中 `R2-P1-18-APP-03 Product binds durably while Dev/Test are held; recovery fills only missing Workers`；该测试继续通过 Task Application 执行 `task.start` 并确认 `ACTIVE`。

### Batch 3 host boundary proof mapping

- `CP-HOST-06` → `packages/platform-host/tests/task-reconciliation.test.ts` + `packages/platform-host/tests/model-business-callers.test.ts`：证明 deterministic progression、bounded catch-up、durable recovery signal 与 Model/System Observer 隔离。
- `CP-HOST-07` → `packages/platform-host/tests/direct-tools-route.test.ts`：证明 authenticated Role × Tool × Operation、server-bound Workspace、Extension Local Tool lane 与 identity injection fail-closed。
- `CP-HOST-11` → `packages/platform-host/tests/task-application-entry.test.ts`：真实 application HTTP 路径证明 `Task.create(PENDING) → 3×worker.create → TaskRoleBinding → READY → startTask`；缺失 Worker/Conversation 的恢复由 backend Reconciliation 内部 Worker recovery 负责，不再暴露人工 Worker-recovery operation。bounded rediscovery / recovery 的 executable proof 归 `packages/platform-host/tests/task-reconciliation.test.ts`。
- Collaboration Browser physical lifecycle 的 Owner/Carrier proof 归 `execution-browser-extension`；Host 只做 `collaboration.*` transport/composition，不以此 Test Plan 宣称 physical Browser E2E。
- Browser Executor 注入唯一 `execution-runtime` binary/readiness 属 **Batch 4 / P1-15**，Host/Browser 本批不得建立 alternate Execution Runtime。

### CP-HOST-12 / RF-HOST-12 — GPT-facing Execution surface removed

- Product/Dev/Test shipped OpenAPI 与 Host Role ACL 中 `executeCapability/getExecution/readExecutionOutput` 必须为零。
- 若平台内部仍调用 Execution read/lookup contract，只能来自受信任 internal client，不得经 GPT Action 暴露或接受 GPT 自报 execution identity。
- Direct Tool response 不返回 `executionRef`，也不要求 Execution polling；只能返回 bounded result 或 provider-native handle。

### CP-HOST-13 / RF-HOST-13 — Direct Tool request/admission identity

- `repomix/localDev/codeGraph` GPT-facing body 只允许 `operation + input`，禁止 `taskId/nodeId/runNo/workerRef/roleRef/actorRef/executionRef`。
- authenticated Role 来自 Gateway transport；workspace/provider endpoint/credential/timeout/enabled 均由 server-bound config 决定。
- wrong Role、forbidden operation、disabled/unready provider 必须在投递 Extension 前 typed reject；absence of Task/Node/Worker correlation 不得阻塞普通 Tool call。

### CP-HOST-14 / RF-HOST-14 — Carrier File Bridge → durable Execution materialization

- ChatGPT/Carrier file ingress used by `putTaskDocument` must call the Execution-owned external-file materialization surface with a stable idempotency identity derived from the Task mutation intent.
- The materialization request carries the authenticated Role and canonical Task Worker scope; transport File refs/locators never bypass Execution ownership.
- Repeating the same Task mutation must converge on the same materialization Execution/Artifact truth instead of creating duplicate downloads/materializations.

**RF-HOST-14:** Host sends the pre-Batch-4 materialization DTO without idempotency/scope, or directly materializes Carrier bytes outside Execution.

## Batch 4 Pre-Smoke Executable Proof Binding

> 本节绑定 Batch 4 新增 Host transport/admission proof；实际 PASS 留给本机 targeted verification。

| Proof | Executable asset | Required behavior |
|---|---|---|
| `CP-HOST-12` | `packages/platform-host/tests/platform-host-critical-proofs.test.ts` + Role package static tests | shipped GPT surface excludes `executeCapability/getExecution/readExecutionOutput`; `/actions/getExecution` is rejected while trusted internal Execution transport remains available |
| `CP-HOST-13` | `packages/platform-host/tests/direct-tools-route.test.ts` | GPT Direct Tool body is only `operation + input`; Role/Workspace/deadline/command identity are server-bound and nested platform identity injection is rejected |
| `CP-HOST-14` | `packages/platform-host/tests/platform-host-critical-proofs.test.ts` | Carrier File Bridge supplies stable materialization idempotency + authenticated role/canonical worker scope before durable Execution materialization |
| Approval application | `packages/platform-host/tests/platform-host-critical-proofs.test.ts` | dedicated loopback credential, fixed human actor/decision semantics, Host owns no Approval business state |

Host remains transport/composition only: it must not become Approval owner, Artifact store, a universal scheduler, or a second Execution runtime; bounded deterministic reconciliation is required.

## Pre-Smoke Batch 5 — Model business caller reconciliation

- `CP-HOST-15` — deterministic Task Reconciliation 不调用 Model；只有独立 System Assessment 通过 shipped Observer application transport 调用 `system.health-assessment.v1 / reason / background / extension:system-observer`。
- Executable proof: `packages/platform-host/tests/model-business-callers.test.ts` starts a real platform-host with a bounded fake Model HTTP dependency, proves normal Task reconciliation has zero Model call, and observes the System Assessment inference request.
- Host remains transport/composition only；System Assessment 为 read-only diagnostic lane，不授予 Effect、Approval、Task mutation 或 retry authority，也不得占用 Task progression single-flight/lock。

## 2026-09-09 Real-3 Direct Tool / Reconciliation Refactor Gate

- [ ] **CP-HOST-16** — `localDev(read package.json)` 从 GPT Action 到 Host admission 只做一次 Tool routing，不查询 Task Owner、不创建 Execution、不做 Execution identity callback。
- [ ] **CP-HOST-17** — Host 将 Tool command 投递到 Extension `/v1/local-tools/commands/*`；任何 Host→`execution-local` / fs / git / process / shell / Repomix CLI / CodeGraph CLI 直连都是 release blocker。
- [ ] **CP-HOST-18** — Repomix、Local Dev、CodeGraph 三个 provider readiness 独立；无关 Model Runtime 或 Execution Runtime DOWN 不阻塞已 READY Tool Provider。
- [ ] **CP-HOST-19** — backend Task Observer/Reconciliation 使用 durable Owner facts + bounded catch-up；Extension event/page reconnect 只加速，全部丢失仍可最终发现 Dev complete→Test READY。
- [ ] **CP-HOST-20** — System Observer/model unavailable 或慢调用不会持有 Task progression single-flight/lock；诊断 lane 与 deterministic progression lane 故障隔离。
- [ ] **CP-HOST-21** — Browser Reality Bridge 的现有 command queue/pending map 不得被 Local Tool 复用；Host/bridge 侧必须存在独立 Local Tool queue/pending/consumer/readiness。

本 Addendum 已进入实现后 executable binding：`CP-HOST-16/17` 由 `packages/platform-host/tests/direct-tools-route.test.ts`，`CP-HOST-19/20` 由 `packages/platform-host/tests/task-reconciliation.test.ts` + `model-business-callers.test.ts`，`CP-HOST-21` 由 `packages/execution-browser-extension/tests/background-observer-application.test.ts` 与 Local Tool bridge/critical proofs 共同证明。`CP-HOST-18` 的完整 provider outage 隔离仍需最终真实部署 Gate 证明，不以单元测试冒充 Real-3 PASS。

## 独立审计补充：真实反例驱动验收

以下为现有 CP-HOST-16..21 的 acceptance 细化，不绑定或改写 executable assets。

| 不变量 | 真实 fixture / 故障注入 | 必须观察 | 不能作为最终证据 |
|---|---|---|---|
| 一次 read | 临时真实 workspace 的 package.json，经已认证 Gateway → Host → 真实 Extension → bridge → provider | 1 Action 返回精确文件/hash；Task Query、Execution admission/record/ref/polling 均为 0；记录每 hop 时长 | stub file reader、只查源码字符串 |
| Host 无 bypass | Host credential 直接调用 execute/poll/report，及篡改 Role/Workspace/参数/过期 generation | 全拒绝，磁盘无 effect；正常 Extension claim 后一次执行成功 | 仅断言没有 node:fs import |
| operation readiness | 分别停止真实 Model、Execution、CodeGraph provider；先启动 Bridge 再启动 Host；所有 page kicks 禁用 | Task/Peer 继续；Local Dev/Repomix 继续；Model DOWN 时 deterministic WAKE 仍实际提交；缺失依赖只拒绝对应 operation | fake ready=true、只改返回 boolean |
| catch-up 公平性 | 创建超过两页 nonterminal tasks，首个 Task projection 超时；末页 Dev complete→Test READY；丢弃全部 events | cursor 到达末页并发现 Test READY；以测试配置 pageSize=100/concurrency=4 验证边界，数字可配置、slow Task 不阻塞其它 Task | listTasks 全量返回后 slice |
| 无重复/ghost wake | 同 task 重复 event+tick+重启；投递前 terminal/reopen/binding 变更；UNKNOWN delivery | 同一 stable intent 无重复 effect；stale 未开始命令不提交；已在途 effect 如实记录 | 单次单飞、固定 snapshot、承诺撤销已提交消息 |
| 诊断隔离 | 同 Task diagnostic 永不 resolve，同时新 READY Task / 同 Task fresh owner event | progression 不等诊断、不持其 lock；stop 后晚到 callback 不 dispatch | 只测不同 Task 或快 fake model |

冷启动图测试既调用现有 buildDependencyGraph，也启动实际 module lifecycle 验证 Host facts 缺失时 bridge 可监听、Model/Execution absent 时 Host 可认证 Task 请求。不能把声明 DAG PASS 当 runtime bootstrap PASS。

目标图验收必须显式包含 `agent-runtime.requires`：先保留旧 execution 边重现 DEPENDENCY_CYCLE，再删除该非启动依赖后验证全模块 DAG；并验证 Execution absent 时 Role store/Task/Peer 可工作，physical delivery 仍按 operation unavailable，不伪造 delivery success。

## 2026-09-13 Real-3｜Permission Context / Role Validation Closure Addendum

- [ ] **CP-HOST-22** — `browser.permission.classify` 对当前 Task-bound Conversation 必须接受真实 ChatGPT locator `/g/g-<roleRef>-<slug>/c/<workerRef>`，同时兼容不带 slug 的 canonical role segment；必须拒绝错误 roleRef、错误 workerRef、附加 query/hash 或非当前 conversation URL，不能把真实 slugged GPT URL 误判成 `CONTEXT_MISMATCH`。
- [ ] **CP-HOST-23** — Permission classification 使用当前 Role registration + role-carrier validation facts；`registeredPackageVersion/roleRef/carrierUrl` 任一漂移都 fail-closed，但正式 Role adopt/reload 后必须 re-read current durable registration，不能让旧 Host cache 永久产生 `ROLE_VALIDATION_MISMATCH`。
- [ ] **RF-HOST-22** — parser 只接受裸 `roleRef` path segment，导致真实 `g-<roleRef>-<slug>` Conversation 全部误拒绝，或放宽到可接受 wrong role/worker/query/hash。
- [ ] **RF-HOST-23** — durable Role registration 已更新但 Host 仍用旧缓存分类 Permission，或版本不匹配时反而 AUTO_ALLOW。

**Executable proof target**：`packages/platform-host/tests/browser-permission-policy.test.ts` 必须覆盖 slugged URL allow + wrong role/worker/query/hash reject + role registration/version mismatch/reload cases；真实 SAME_SCENE Permission 仍由 Real Chrome gate 证明，不以 pure policy test 冒充页面 E2E。

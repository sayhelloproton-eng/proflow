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
sourceBaseline: ProFlow-ProFlow-DDD规范化技术文档-最终冻结基线-20260812.zip
sourceBaselineSha256: 69fdfbac8a5ee36b700bcb10c0b8a9a61f0a5aa3367386cb5bc7e98118a4a875
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
Task/System Observer logic
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

- [ ] **CP-HOST-01** — 只装配独立 Task/Agent packages与Execution/Model public clients。
- [ ] **CP-HOST-02** — Domain package不反向依赖host；host无业务Repository/state mirror。
- [ ] **CP-HOST-03** — local transport/startup/shutdown/drain可重复且保留typed owner request字段。
- [ ] **CP-HOST-04** — health只聚合host-owned process/transport/dependency，不发明Domain READY。
- [ ] **CP-HOST-05** — restart重建graph并re-read owner reality，不replay mutation。
- [ ] **CP-HOST-06** — Extension Task/System Observer可通过正式public clients获得所需projection/infer能力；host不实现Observer loop/assessment truth。
- [ ] **CP-HOST-07** — 无universal scheduler/event bus、Browser DOM/frame/tab registry、direct complete/reopen/approve路径。

## 5. Failure Families

- host吸收Task/Agent/Execution business persistence；
- dependency unavailable被改写为业务状态；
- restart从host cache恢复owner facts；
- Task Observer逻辑偷偷进入host timer；
- System Observer assessment被host当truth；
- host直接WAKE Browser或调用dangerous effect。

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
- [ ] **CP-HOST-10** — Test/Ops canonical OpenAPI 与 role ACL 对 `startNode` 一致。
- [ ] **RF-HOST-08** — management 无认证、CLI 直读 Task DB、或 Role delete 绕过 Task usage owner port。
- [ ] **RF-HOST-09** — platform-host 出现 Collaboration timer/scheduler、以内部 caller 自动重放 pending message、拥有 Browser delivery truth，或绕过 Agent/Execution/Extension Owner boundary。
- [ ] **RF-HOST-10** — Role OpenAPI 与 Host ACL 漂移。

**Executable proof**：`packages/platform-host/tests/presmoke-batch2-agent-collaboration.test.ts`。


## 2026-08-15 Pre-Smoke Batch 3｜Browser Application / Observer / Carrier Addendum

- [ ] **CP-HOST-11** — Extension Task Application 通过 authenticated loopback composition 实际完成 `Task.create(PENDING) → 固定三 Role Worker 经 Execution 创建并回写 TaskRoleBinding → Task READY → Task.start(ACTIVE)`；UI/host 均不复制 Task readiness/state-machine truth。
- [ ] **RF-HOST-11** — Worker 创建绕过 Execution、UI/host 直接写 Task binding/readiness、缺失 binding 被假定成功、或通过第二套 Task Store 完成 J1。

**Executable proof**：`packages/platform-host/tests/task-application-entry.test.ts` 中 `PRESMOKE-B3-APP-03`。


### Batch 3 host boundary proof mapping

- `CP-HOST-06/07` → `packages/platform-host/tests/journey-observer-composition-boundary.test.ts`：Host 只暴露 authenticated Task/System Observer owner/model transport，且无 Observer/Carrier timer、business scheduler、assessment truth。
- `CP-HOST-11` → `packages/platform-host/tests/task-application-entry.test.ts`：真实 application HTTP 路径证明 `Task.create(PENDING) → 3×worker.create → TaskRoleBinding → READY → startTask`，并证明中途 Worker 创建失败后 `task.ensureWorkers` 只补缺失 binding、不重建已成功 Worker。
- Collaboration Browser physical lifecycle 的 Owner/Carrier proof 归 `execution-browser-extension`；Host 只做 `collaboration.*` transport/composition，不以此 Test Plan 宣称 physical Browser E2E。
- Browser Executor 注入唯一 `execution-runtime` binary/readiness 属 **Batch 4 / P1-15**，Host/Browser 本批不得建立 alternate Execution Runtime。


### CP-HOST-12 / RF-HOST-12 — Execution read scope admission

- GPT-facing `getExecution/readExecutionOutput` 必须由 platform-host 注入 `authenticatedRoleRef`，请求体不得自报 caller identity。
- Execution Runtime 首先校验 durable `ExecutionRecord.callerRef`；Task-scoped record 还必须重新核对 `roleRef` 与 Task Owner 当前 `TaskRoleBinding.workerRef`。
- `readExecutionOutput` 必须先通过同一 Execution read admission，再读取 Artifact bytes；知道 `executionRef` 不得绕过 Task/Role/Worker scope。
- Artifact output identity 使用 `artifactRef`；不得把 output ArtifactRef 塞进 `evidenceRef`。


### CP-HOST-13 / RF-HOST-13 — Uncertain Execution lookup without replay

- Gateway timeout/reconciliation 对 `executeCapability` 不要求事先知道 server-generated `executionRef`；platform-host 可使用 authenticated role + canonical Task worker + `capability/idempotencyKey/critical input` 调 Execution Owner 的 intent lookup。
- lookup 必须验证 durable input fingerprint；同 idempotency key 不同关键输入必须 `IDEMPOTENCY_CONFLICT`。
- lookup 只读 existing Execution record，不调用 executor，不创建第二 physical intent；返回前仍复用 `admitExecutionRead` 的 caller + Task/Role/Worker scope admission。

### CP-HOST-14 / RF-HOST-14 — Carrier File Bridge → durable Execution materialization

- ChatGPT/Carrier file ingress used by `putTaskDocument` must call the Execution-owned external-file materialization surface with a stable idempotency identity derived from the Task mutation intent.
- The materialization request carries the authenticated Role and canonical Task Worker scope; transport File refs/locators never bypass Execution ownership.
- Repeating the same Task mutation must converge on the same materialization Execution/Artifact truth instead of creating duplicate downloads/materializations.

**RF-HOST-14:** Host sends the pre-Batch-4 materialization DTO without idempotency/scope, or directly materializes Carrier bytes outside Execution.

## Batch 4 Pre-Smoke Executable Proof Binding

> 本节绑定 Batch 4 新增 Host transport/admission proof；实际 PASS 留给本机 targeted verification。

| Proof | Executable asset | Required behavior |
|---|---|---|
| `CP-HOST-12` | `packages/platform-host/tests/platform-host-critical-proofs.test.ts` | authenticated role → Execution caller ownership → current TaskRoleBinding role/worker read admission |
| `CP-HOST-13` | `packages/execution-runtime/tests/execution-runtime-critical-proofs.test.ts` + Host lookup path | uncertain timeout uses Owner intent lookup; same intent does not replay executor; lookup result still passes read admission |
| `CP-HOST-14` | `packages/platform-host/tests/platform-host-critical-proofs.test.ts` | Carrier File Bridge supplies stable materialization idempotency + authenticated role/canonical worker scope before durable Execution materialization |
| Approval application | `packages/platform-host/tests/platform-host-critical-proofs.test.ts` | dedicated loopback credential, fixed human actor/decision semantics, Host owns no Approval business state |

Host remains transport/composition only: it must not become Approval owner, Artifact store, Observer scheduler, or a second Execution runtime.

## Pre-Smoke Batch 5 — Model business caller reconciliation

- `CP-HOST-15` — shipped Observer application transport calls the single Model `infer(...)` contract: Task Diagnostic uses `task.diagnostic.v1 / reason / business / extension:task-observer`, while System Assessment uses `system.health-assessment.v1 / reason / background / extension:system-observer`.
- Executable proof: `packages/platform-host/tests/model-business-callers.test.ts` starts a real platform-host with a bounded fake Model HTTP dependency and observes the forwarded inference requests.
- Host remains transport/composition only; Task Diagnostic is advisory and System Assessment is read-only. Neither path grants Effect, Approval, Task mutation, or retry authority.

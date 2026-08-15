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

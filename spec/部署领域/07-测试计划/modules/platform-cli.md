---
docId: TP-MODULE-PLATFORM-CLI
title: platform-cli｜开发前 Module Test Plan
docType: test-plan
authority: normative
lifecycle: active
domain: deployment-governance
subdomain: null
subdomains: []
boundedContext: deployment-governance
moduleRef: platform-cli
provides: []
requires: []
contractRefs: []
testPlanPhase: PRE_IMPLEMENTATION
testPlanStatus: FINAL_FROZEN
sourceRefs:
- DEPLOYMENT-PLATFORM-CLI-TECH-DESIGN
- DEPLOYMENT-DOC-05-02
- DEPLOYMENT-DOC-05-03
- DEPLOYMENT-DOC-03-04
implementationWave: Wave 6
---

# `platform-cli` 开发前 Module Test Plan

> 状态：**FINAL_FROZEN**  
> Implementation Wave：**Wave 6**  
> 本文只冻结“必须证明什么”；开发后 exact fixture / command / actual result / evidence ref 进入未来 `08-测试用例与验证/`。

## 1. Source of Truth

- [`DEPLOYMENT-PLATFORM-CLI-TECH-DESIGN`](../../04-模块/platform-cli/TECHNICAL-DESIGN.md)
- [`DEPLOYMENT-DOC-05-02`](../../05-质量与部署/02-测试门禁与真实验收.md)
- [`DEPLOYMENT-DOC-05-03`](../../05-质量与部署/03-新仓库实施顺序-停止门与非目标.md)
- [`DEPLOYMENT-DOC-03-04`](../../03-流程与数据/04-部署状态-目录-Secret与安全.md) — 部署状态、目录、Secret 与安全

## 2. 风险定位

CLI 是唯一全局 Deployment Planner/Executor；错误 graph、stale state 或不可恢复 apply 会直接造成部署错误。

## 3. 必须覆盖的测试层

原 v0.1 已确认的 Module-specific 测试层保持不变：

- Unit
- Contract
- Offline Fake-Module Integration
- Real External Resource
- Fault/Resume
- Cross-domain Deployment

### 3.1 Test Layer Applicability Matrix

> `REQUIRED` 表示开发前计划必须覆盖；不表示必须在当前 Wave 立即执行真实环境测试。真实执行时机仍由实施 Wave/Gate 控制。`NOT_APPLICABLE` 只表示 Frozen SDD 未给本 Module 该层责任，禁止为了模板完整强行新增测试。

| Layer | Applicability | Basis |
|---|---|---|
| Unit | **REQUIRED** | 由本 Module 现有 Critical Proof / v0.1 必测层直接要求。 |
| Domain Behavior | **NOT_APPLICABLE** | 该 Module 不拥有独立领域状态机/业务规则；不为模板完整性制造 Domain Behavior 层。 |
| Contract / Runtime Schema | **REQUIRED** | 由本 Module 现有 Critical Proof / v0.1 必测层直接要求。 |
| Persistence | **REQUIRED** | Frozen Deployment design assigns repo-local plan/state/history/manifest records and config materialization to the deployment application; stale persisted state must never override current reality. |
| Generated Artifact / Package Conformance | **NOT_APPLICABLE** | 该 Module 不生成 template/package/skill artifact，不增加此类测试层。 |
| Module Integration | **REQUIRED** | 由本 Module 现有 Critical Proof / v0.1 必测层直接要求。 |
| Cross-Domain Integration | **REQUIRED** | 由本 Module 现有 Critical Proof / v0.1 必测层直接要求。 |
| Process Lifecycle | **NOT_APPLICABLE** | 该 Module 不是独立长期运行 Process/Service lifecycle owner。 |
| Real Local Integration | **REQUIRED** | Frozen platform-cli design requires real repo-local config/state/manifest materialization and atomic file behavior in a workspace. |
| Real External E2E | **REQUIRED** | 由本 Module 现有 Critical Proof / v0.1 必测层直接要求。 |
| Failure / Recovery | **REQUIRED** | 由本 Module 现有 Critical Proof / v0.1 必测层直接要求。 |
| Security / Boundary | **REQUIRED** | 由本 Module 现有 Critical Proof / v0.1 必测层直接要求。 |
| Concurrency / Idempotency | **REQUIRED** | Frozen Deployment flow requires one apply per workspace via exclusive apply/workspace lock, plus safe resume/satisfied-step skip semantics. |
| Stability / Performance | **NOT_APPLICABLE** | 冻结 SDD 未为该 Module定义独立稳定性/性能 Gate；不自动生成阈值。 |

## 4. Real / Fake Boundary

**Real requirement**：Offline Gate 先用 fake Modules；真实生命周期、External Resource、Upgrade 在 Wave 6/7 做真实验收。

**允许的隔离方式**：可 fake Module primitive 注入错误，但 `status/verify/doctor` 最终真实验收不能只靠 persisted/mock state。

## 5. Critical Proofs

- [ ] **CP-DPL-CLI-01** — module discovery/materialization/preflight 能发现 missing/incompatible/cyclic dependency，而不是在 apply 中途才失败。
- [ ] **CP-DPL-CLI-02** — plan 固定目标与步骤；stale plan 被识别；同 planRef resume 先重看 reality，已满足 step skip。
- [ ] **CP-DPL-CLI-03** — ACTION_REQUIRED 是可恢复边界；human/failure 均 STOP，不演化为长期 workflow engine。
- [ ] **CP-DPL-CLI-04** — start/stop 只对真实声明该 primitive 的 Deployment Unit 生效；library/remote resource 不伪造。
- [ ] **CP-DPL-CLI-05** — status/verify/doctor 读取 current reality；persisted history 不能制造 fake READY。
- [ ] **CP-DPL-CLI-06** — upgrade fail 保留 verification history，STOP + doctor；rollback 通过新 Plan，不做事务式自动 rollback。
- [ ] **CP-DPL-CLI-07** — same workspace 只允许一个 apply：exclusive workspace lock 生效；repo-local plan/state/config 采用安全原子写，concurrent apply 不破坏 deployment state。
- [ ] **CP-DPL-CLI-08** — Shell-global `platform` 只允许 0/1 个全局受管 Workspace；canonical workspace identity + cross-process global operation lock 能阻断 A/B 并发双安装，并串行化 `install/apply/start/stop/restart/upgrade/uninstall` 等实例 mutation；binding 持久化 `INSTALLING / INSTALLED / UNINSTALLING / BROKEN`。
- [ ] **CP-DPL-CLI-09** — 首次 `platform install` 默认以 cwd 为目标，`--workspace <path>` 可供 Agent 显式指定；绑定完成后 `status/start/stop/restart/verify/doctor/modules/upgrade` 均从任意 cwd 操作唯一 bound Workspace，`status` 必须暴露 `boundWorkspace`。
- [ ] **CP-DPL-CLI-10** — `platform uninstall`（无 module 参数）从任意 cwd 卸载当前 Platform Instance、观察 Managed Modules 归零后清除 binding；A 未卸载前 B install 必须 `WORKSPACE_ALREADY_BOUND`，A 卸载后才允许 bind B；丢失 Workspace 只允许显式 `--forget` 清 stale binding，不伪造资源已清理。
- [ ] **CP-DPL-CLI-11** — Workspace package mutation 对 npm/yarn/pnpm 一视同仁；选择以 `package.json#packageManager → lockfile → executable` 的确定性事实为准，声明/lockfile 冲突或 executable 缺失必须 typed fail，不猜测。
- [ ] **CP-DPL-CLI-22** — Platform CLI 不发明 Task worker/conversation/browser identity；worker/c-id 只由 Owner/Execution 产生，Deployment 只连接 lifecycle/status/verify primitive。

## 6. Frozen TODO Coverage

> 本表不修改 Frozen TODO 的 `priority / dependsOn / implementationReadiness / ACCEPTANCE_NOT_FROZEN`。这里的 Acceptance 仅是**开发前 Test Plan 的 proof acceptance**，完全复用 §5 已存在的 Critical Proof，不回写成 TODO implementation acceptance。

| TODO | Frozen Goal | Frozen Anchor | Normative Rule Refs | Critical Proof | Scenario Family | Test Plan Acceptance |
|---|---|---|---|---|---|---|
| `DPL-CLI-001` | 实现 module discovery/materialization 与 dependency graph preflight | `DEPLOYMENT-GOVERNANCE-TODO-PLATFORM-CLI` § `DPL-CLI-001` | `DEPLOYMENT-PLATFORM-CLI-TECH-DESIGN`<br>`DEPLOYMENT-DOC-02-01` | `CP-DPL-CLI-01` | module discovery/materialization 与 dependency graph preflight | module discovery/materialization/preflight 能发现 missing/incompatible/cyclic dependency，而不是在 apply 中途才失败。 |
| `DPL-CLI-002` | 实现 plan/apply、ACTION_REQUIRED resume、satisfied-step skip | `DEPLOYMENT-GOVERNANCE-TODO-PLATFORM-CLI` § `DPL-CLI-002` | `DEPLOYMENT-PLATFORM-CLI-TECH-DESIGN`<br>`DEPLOYMENT-DOC-02-01` | `CP-DPL-CLI-02`<br>`CP-DPL-CLI-03`<br>`CP-DPL-CLI-07` | plan/apply、ACTION_REQUIRED resume、satisfied-step skip | plan 固定目标与步骤；stale plan 被识别；同 planRef resume 先重看 reality，已满足 step skip。；ACTION_REQUIRED 是可恢复边界；human/failure 均 STOP，不演化为长期 workflow engine。；same workspace 只允许一个 apply：exclusive workspace lock 生效；repo-local plan/state/config 采用安全原子写，concurrent apply 不破坏 deployment state。 |
| `DPL-CLI-003` | 实现 start/stop/status/verify/doctor/manifest/upgrade/repair intents | `DEPLOYMENT-GOVERNANCE-TODO-PLATFORM-CLI` § `DPL-CLI-003` | `DEPLOYMENT-PLATFORM-CLI-TECH-DESIGN`<br>`DEPLOYMENT-DOC-02-01` | `CP-DPL-CLI-04`<br>`CP-DPL-CLI-05`<br>`CP-DPL-CLI-06` | start/stop/status/verify/doctor/manifest/upgrade/repair intents | start/stop 只对真实声明该 primitive 的 Deployment Unit 生效；library/remote resource 不伪造。；status/verify/doctor 读取 current reality；persisted history 不能制造 fake READY。；upgrade fail 保留 verification history，STOP + doctor；rollback 通过新 Plan，不做事务式自动 rollback。 |
| `DPL-CLI-004` | 实现 repo-local deployment state/version verification records | `DEPLOYMENT-GOVERNANCE-TODO-PLATFORM-CLI` § `DPL-CLI-004` | `DEPLOYMENT-PLATFORM-CLI-TECH-DESIGN`<br>`DEPLOYMENT-DOC-02-01` | `CP-DPL-CLI-05`<br>`CP-DPL-CLI-07` | repo-local deployment state/version verification records | status/verify/doctor 读取 current reality；persisted history 不能制造 fake READY。；same workspace 只允许一个 apply：exclusive workspace lock 生效；repo-local plan/state/config 采用安全原子写，concurrent apply 不破坏 deployment state。 |
| `DPL-CLI-005` | 实现 Platform READY aggregation 与 typed blocking diagnostics | `DEPLOYMENT-GOVERNANCE-TODO-PLATFORM-CLI` § `DPL-CLI-005` | `DEPLOYMENT-PLATFORM-CLI-TECH-DESIGN`<br>`DEPLOYMENT-DOC-02-01` | `CP-DPL-CLI-05` | Platform READY aggregation 与 typed blocking diagnostics | status/verify/doctor 读取 current reality；persisted history 不能制造 fake READY。 |
| `DPL-CLI-006` | 完成 interrupted apply/upgrade/external-action resume E2E | `DEPLOYMENT-GOVERNANCE-TODO-PLATFORM-CLI` § `DPL-CLI-006` | `DEPLOYMENT-PLATFORM-CLI-TECH-DESIGN`<br>`DEPLOYMENT-DOC-02-01` | `CP-DPL-CLI-02`<br>`CP-DPL-CLI-03`<br>`CP-DPL-CLI-06` | interrupted apply/upgrade/external-action resume E2E | plan 固定目标与步骤；stale plan 被识别；同 planRef resume 先重看 reality，已满足 step skip。；ACTION_REQUIRED 是可恢复边界；human/failure 均 STOP，不演化为长期 workflow engine。；upgrade fail 保留 verification history，STOP + doctor；rollback 通过新 Plan，不做事务式自动 rollback。 |

## 7. Required Failure / Boundary Families

只覆盖 Frozen SDD / §5 Critical Proof 已经存在的失败与边界；不从通用 checklist 新增产品需求。

- [ ] **RF-DPL-CLI-01** — missing/incompatible/cyclic dependency 未在 preflight 阻断
- [ ] **RF-DPL-CLI-02** — stale plan 或 resume 未重新观察 reality、已满足 step 被重复执行
- [ ] **RF-DPL-CLI-03** — ACTION_REQUIRED/interrupted apply/upgrade 无法安全 resume
- [ ] **RF-DPL-CLI-04** — 对 Library/remote resource 调用虚假 start/stop
- [ ] **RF-DPL-CLI-05** — persisted history 制造 fake READY 或 status/verify/doctor 不读 current reality
- [ ] **RF-DPL-CLI-06** — config/secret materialization 越界，或 raw secret 泄漏到 manifest/JSON/log/evidence/model context
- [ ] **RF-DPL-CLI-07** — upgrade failure 丢失 verification history 或擅自事务式自动 rollback
- [ ] **RF-DPL-CLI-08** — same-workspace concurrent apply 绕过 exclusive lock，或 repo-local state/config 原子写失败导致部署状态损坏
- [ ] **RF-DPL-CLI-09** — global binding 可被第二 Workspace 覆盖/静默切换，或并发 install/apply/lifecycle/upgrade/uninstall 绕过 global operation lock 并同时修改唯一 Platform Instance
- [ ] **RF-DPL-CLI-10** — instance command 错把当前 cwd 当目标，`status` 不暴露 bound Workspace，或 `--workspace` 被用来绕过唯一 binding
- [ ] **RF-DPL-CLI-11** — whole-instance uninstall 未确认真实卸载就清 binding，missing Workspace 被伪装成已清理，或 A 未卸载即允许 bind B
- [ ] **RF-DPL-CLI-12** — package-manager 被硬编码为 pnpm/npm、yarn 无法工作、声明与 lockfile 冲突时仍猜测执行器




## 8. Evidence Contract

本阶段只冻结**未来必须可观测的 Evidence 类型**；exact fixture / command / actual result / evidenceRef 仍留到开发后 `08-测试用例与验证/`。

- **EV-DPL-CLI-01** — dependency graph/preflight diagnostics
- **EV-DPL-CLI-02** — planRef、step、stale/satisfied 状态与 resume trace
- **EV-DPL-CLI-03** — ACTION_REQUIRED/interrupted apply/upgrade resume trace
- **EV-DPL-CLI-04** — current reality 的 status/verify/doctor result
- **EV-DPL-CLI-05** — config materialization path/permission 与 secret-redaction observation
- **EV-DPL-CLI-06** — manifest/version/verification history
- **EV-DPL-CLI-07** — upgrade failure + STOP/doctor/new-plan recovery record
- **EV-DPL-CLI-08** — exclusive workspace lock/concurrent apply observation + repo-local state/config atomic-write result
- **EV-DPL-CLI-09** — lifecycle primitive dispatch observation by Module kind
- **EV-DPL-CLI-10** — global binding record/state/instanceId/canonical path + concurrent A/B install and bound-instance mutation lock observation
- **EV-DPL-CLI-11** — cwd vs `--workspace` requested target、cross-directory instance command、`status.boundWorkspace` observation
- **EV-DPL-CLI-12** — whole-instance uninstall → managed set empty → binding clear / stale `--forget` observation / A→B rebind trace
- **EV-DPL-CLI-13** — npm/yarn/pnpm selection source、lockfile conflict、executable availability 与 package mutation argv observation

## 8.1 Critical Proof → Risk → Layer → Evidence Binding

> 本表完成 `Frozen TODO → Critical Proof → Risk → Test Layer → Evidence` 的显式链。RF/EV 只是本文内导航 identity，不是新的产品 Contract/capability。Test Plan Acceptance 仍以 §5 Critical Proof 为准；本文不冻结 TODO priority、dependsOn 或 implementation acceptance。

| Critical Proof | Required Test Layer(s) | Risk / Failure Ref(s) | Required Evidence Ref(s) |
|---|---|---|---|
| `CP-DPL-CLI-01` | `Contract / Runtime Schema`<br>`Module Integration` | `RF-DPL-CLI-01` | `EV-DPL-CLI-01` |
| `CP-DPL-CLI-02` | `Persistence`<br>`Real Local Integration`<br>`Failure / Recovery` | `RF-DPL-CLI-02` | `EV-DPL-CLI-02` |
| `CP-DPL-CLI-03` | `Cross-Domain Integration`<br>`Failure / Recovery` | `RF-DPL-CLI-03` | `EV-DPL-CLI-03` |
| `CP-DPL-CLI-04` | `Module Integration`<br>`Real External E2E` | `RF-DPL-CLI-04` | `EV-DPL-CLI-09` |
| `CP-DPL-CLI-05` | `Persistence`<br>`Real Local Integration`<br>`Real External E2E`<br>`Failure / Recovery` | `RF-DPL-CLI-05` | `EV-DPL-CLI-04`<br>`EV-DPL-CLI-06` |
| `CP-DPL-CLI-06` | `Persistence`<br>`Real External E2E`<br>`Failure / Recovery` | `RF-DPL-CLI-07` | `EV-DPL-CLI-06`<br>`EV-DPL-CLI-07` |
| `CP-DPL-CLI-07` | `Persistence`<br>`Real Local Integration`<br>`Security / Boundary`<br>`Concurrency / Idempotency` | `RF-DPL-CLI-06`<br>`RF-DPL-CLI-08` | `EV-DPL-CLI-05`<br>`EV-DPL-CLI-06`<br>`EV-DPL-CLI-08` |
| `CP-DPL-CLI-08` | `Persistence`<br>`Real Local Integration`<br>`Concurrency / Idempotency` | `RF-DPL-CLI-09` | `EV-DPL-CLI-10` |
| `CP-DPL-CLI-09` | `Contract / Runtime Schema`<br>`Real Local Integration` | `RF-DPL-CLI-10` | `EV-DPL-CLI-11` |
| `CP-DPL-CLI-10` | `Persistence`<br>`Real Local Integration`<br>`Failure / Recovery` | `RF-DPL-CLI-11` | `EV-DPL-CLI-12` |
| `CP-DPL-CLI-11` | `Contract / Runtime Schema`<br>`Real Local Integration` | `RF-DPL-CLI-12` | `EV-DPL-CLI-13` |
| `CP-DPL-CLI-22` | `Module Integration` | — | — |

## 8.2 Codex TDD Handoff

当 Implementation Wave/Gate 允许某个 Frozen TODO 开工时：

1. 从 §6 选择该 TODO 已绑定的 Critical Proof；**本 Test Plan 不推导 TODO priority 或 dependsOn**。
2. 依据 §8.1，在能够忠实证明该 Proof 的最早 `REQUIRED` 可执行层先写测试，并先观察预期 **RED**；RED 必须来自行为尚未实现，而不是 fixture/环境本身坏掉。
3. **GREEN** 只实现对应 §5 Critical Proof / §6 Test Plan Acceptance 所需的最小行为，不扩展 Frozen Spec。
4. Fake/adapter 可以证明较低层行为，但不能替代 §3/§8.1 标为 REQUIRED 的 Real Local / Real External / Persistence / Process 等真实层。
5. Refactor 只能在相关测试保持 GREEN 下进行；若无法从 Frozen SDD 得到可执行断言、必要 Evidence 不可观察、或必须新增/改变 Public API/Owner/State 才能测试，立即按 §10 `STOP → SPEC_GAP / PENDING_DECISION / PENDING_SPIKE`。

## 9. Module GO

进入 Codex TDD 前，本 Module 的 Test Plan 只在以下条件全部满足时 GO：

- §6 每个 Frozen TODO 都有 Frozen Anchor、Normative Rule Refs、Critical Proof、Scenario Family 和 Test Plan Acceptance；
- §3 所有 `REQUIRED` 层都有可执行验证路径，`NOT_APPLICABLE` 不被强行补测；
- §7 的 Module-specific failure/boundary family 都能在不改变 Frozen Spec 的前提下表达为测试；
- §8 的 Evidence 类型在目标环境中可观察；真实 External E2E 若属于后续 Wave，只要求路径已定义，不伪造实际 PASS；
- 不存在阻断实现的 `SPEC_GAP / PENDING_SPIKE`；不得靠放宽测试或修改冻结 Contract 消除失败。

当前必须控制的 Module 风险：**CLI 是唯一全局 Deployment Planner/Executor；错误 graph、stale state 或不可恢复 apply 会直接造成部署错误。**

## 10. Module STOP

出现以下任一情况立即 STOP，不允许 Codex 自行修 Spec：

- 任一 TODO 无法追溯到 Frozen Anchor / sourceRefs / Critical Proof；
- 任一 `REQUIRED` 测试层必须靠新增 Public API、改变 Owner/BC/Contract 才能实现；
- §7 的关键 failure/recovery 在 Frozen SDD 中没有确定语义；
- §8 所需 Evidence 无法从 owner/runtime/reality 观察，只能靠 Mock 自证；
- 真实 External Boundary 只能由 Fake PASS，或 `PENDING_SPIKE` 被当成已验证能力；
- 为了让测试通过必须改变 frozen TODO goal。

若风险“CLI 是唯一全局 Deployment Planner/Executor；错误 graph、stale state 或不可恢复 apply 会直接造成部署错误。”无法通过当前 Frozen Contract/Boundary 得到可执行证明，标记 `SPEC_GAP` 并停止进入实现。

## 11. 2026-08-14 Carrier Readiness / Human Action Addendum

`platform-cli` 对 Carrier/Role readiness 还必须证明：

- Web-only GPT/workspace/auth/domain/privacy/Always Allow 等未满足时输出 structured `ACTION_REQUIRED(_WEB)`，resume 后重新 discover/verify current reality；
- stale verification 不能让 Role/Platform READY；
- exact model id 不是 readiness gate，required behavior/capability/auth 才是；
- CLI 不生成/猜测 Task `workerRef/c-id`，也不持久化 tab/frame；
- System Observer 的 assessment 不作为 manifest READY 输入真源；只有 owner verification facts 可被聚合。

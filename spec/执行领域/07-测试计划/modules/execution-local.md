---
docId: TP-MODULE-EXECUTION-LOCAL
title: execution-local｜开发前 Module Test Plan
docType: test-plan
authority: normative
lifecycle: active
domain: execution
subdomain: null
subdomains: []
boundedContext: execution
moduleRef: execution-local
provides: []
requires: []
contractRefs: []
testPlanPhase: PRE_IMPLEMENTATION
testPlanStatus: FINAL_FROZEN
sourceRefs:
- EXECUTION-EXECUTION-LOCAL-TECH-DESIGN
- EXECUTION-DOC-02-01
- EXECUTION-DOC-05-02
implementationWave: Wave 3
---

# `execution-local` 开发前 Module Test Plan

> 状态：**FINAL_FROZEN**  
> Implementation Wave：**Wave 3**  
> 本文只冻结“必须证明什么”；开发后 exact fixture / command / actual result / evidence ref 进入未来 `08-测试用例与验证/`。

## 1. Source of Truth

- [`EXECUTION-EXECUTION-LOCAL-TECH-DESIGN`](../../04-模块/execution-local/TECHNICAL-DESIGN.md)
- [`EXECUTION-DOC-02-01`](../../02-契约/01-Public-Contract与TypeScript类型规范.md)
- [`EXECUTION-DOC-05-02`](../../05-质量与部署/02-测试验收-E2E-故障注入.md)

## 2. 风险定位

`execution-local` 是本机 Tool/Effect implementation library：同时承载 Local Dev、Repomix、CodeGraph provider，并可供少量 internal durable Execution mechanics复用。最大风险是边界过宽、与 Repomix 重复、任意 shell 化、provider transport 假实现或 Direct Tool 被重新绑回 Execution lifecycle。

## 3. 必须覆盖的测试层

原 v0.1 已确认的 Module-specific 测试层保持不变：

- Unit
- Contract
- Real Local Integration
- Security Boundary
- Fault/Recovery

### 3.1 Test Layer Applicability Matrix

> `REQUIRED` 表示开发前计划必须覆盖；不表示必须在当前 Wave 立即执行真实环境测试。真实执行时机仍由实施 Wave/Gate 控制。`NOT_APPLICABLE` 只表示 Frozen SDD 未给本 Module 该层责任，禁止为了模板完整强行新增测试。

| Layer | Applicability | Basis |
|---|---|---|
| Unit | **REQUIRED** | 由本 Module 现有 Critical Proof / v0.1 必测层直接要求。 |
| Domain Behavior | **NOT_APPLICABLE** | 该 Module 不拥有独立领域状态机/业务规则；不为模板完整性制造 Domain Behavior 层。 |
| Contract / Runtime Schema | **REQUIRED** | 由本 Module 现有 Critical Proof / v0.1 必测层直接要求。 |
| Persistence | **NOT_APPLICABLE** | 该 Module 不拥有 persistence implementation；持久化正确性由对应 owner Module 的真实集成门证明。 |
| Generated Artifact / Package Conformance | **NOT_APPLICABLE** | 该 Module 不生成 template/package/skill artifact，不增加此类测试层。 |
| Module Integration | **NOT_APPLICABLE** | 冻结 SDD 未定义该 Module 独立组件集成门；其行为由更贴近的 Contract/Role/Conformance 层证明。 |
| Cross-Domain Integration | **NOT_APPLICABLE** | 该 Module 的本地正确性不要求直接跨域；跨域主链由相关 owner 与 Wave 7 验证。 |
| Process Lifecycle | **NOT_APPLICABLE** | 该 Module 不是独立长期运行 Process/Service lifecycle owner。 |
| Real Local Integration | **REQUIRED** | 由本 Module 现有 Critical Proof / v0.1 必测层直接要求。 |
| Real External E2E | **NOT_APPLICABLE** | 该 Module correctness 不直接依赖真实外部资源；外部链由拥有 External Boundary 的 Module 验证。 |
| Failure / Recovery | **REQUIRED** | 由本 Module 现有 Critical Proof / v0.1 必测层直接要求。 |
| Security / Boundary | **REQUIRED** | 由本 Module 现有 Critical Proof / v0.1 必测层直接要求。 |
| Concurrency / Idempotency | **REQUIRED** | Direct Tool 原生 handle/cache、process 控制和重复 execute 安全。 |
| Stability / Performance | **REQUIRED** | deadline、bounded output 与 Provider isolation，详见独立审计补充。 |

## 4. Real / Fake Boundary

**Real requirement**：E2 必须在真实临时 Git 项目运行，关键 fs/git/process/network 行为不得全 Mock。

**允许的隔离方式**：Unit 可 fake filesystem helper；最终 Local Gate 必须真实临时目录/进程/endpoint。

## 5. Critical Proofs

- [ ] **CP-EXE-LOCAL-01** — server-bound workspace root、`..`、absolute/symlink escape 与 protected platform paths fail-closed；GPT request 不可改写 workspace root。
- [ ] **CP-EXE-LOCAL-02** — Local Dev 仅暴露 `read/list/search/mutate/run/process` 六个 family；File/Git/Shell/Process 具体能力归并其中，不再复制 Repomix 的 pack/grep/read 广域上下文能力。
- [ ] **CP-EXE-LOCAL-03** — Local Dev `process` 支持 `list/ports/status/start/read/input/stop`；可只读观察本机已启动进程与端口占用，但 stop/input 等 mutation 受明确 target/policy 约束。
- [ ] **CP-EXE-LOCAL-04** — Repomix provider 精确 `pack/grep/read` 并真实调用已证明的 CLI/npm transport；`outputId` 保持 provider-native handle，不包装 ExecutionRef。
- [ ] **CP-EXE-LOCAL-05** — CodeGraph v1 只暴露 `explore`，真实调用已证明的 CLI/可调用 transport；不存在伪造 HTTP provider/fake integration PASS。
- [ ] **CP-EXE-LOCAL-06** — Local Dev mutate/run/process 的 output bounded、secret redacted；uncertain mutation 不 blind replay，先用 read/status/process/port/Git reality re-observe。

## 6. Frozen TODO Coverage

> 本表不修改 Frozen TODO 的 `priority / dependsOn / implementationReadiness / ACCEPTANCE_NOT_FROZEN`。这里的 Acceptance 仅是**开发前 Test Plan 的 proof acceptance**，完全复用 §5 已存在的 Critical Proof，不回写成 TODO implementation acceptance。

| TODO | Frozen Goal | Frozen Anchor | Normative Rule Refs | Critical Proof | Scenario Family | Test Plan Acceptance |
|---|---|---|---|---|---|---|
| `EXE-LOCAL-001` | 实现 server-bound workspace/path safety 与 protected platform path guard | `EXECUTION-TODO-EXECUTION-LOCAL` § `EXE-LOCAL-001` | `EXECUTION-EXECUTION-LOCAL-TECH-DESIGN`<br>`AGENT-DOC-02-05` | `CP-EXE-LOCAL-01` | workspace/path safety | workspace 不能由 GPT 覆盖；`..`/absolute/symlink/protected path 越界 fail-closed。 |
| `EXE-LOCAL-002` | 收敛 Local Dev 为 read/list/search/mutate/run/process 六个 family | `EXECUTION-TODO-EXECUTION-LOCAL` § `EXE-LOCAL-002` | `EXECUTION-EXECUTION-LOCAL-TECH-DESIGN`<br>`AGENT-DOC-02-05` | `CP-EXE-LOCAL-02` | Local Dev minimal surface | File/Git/Shell/Process 被归并到六类接口，且不复制 Repomix pack/grep/read。 |
| `EXE-LOCAL-003` | 实现 process list/ports/status/start/read/input/stop 与 bounded output | `EXECUTION-TODO-EXECUTION-LOCAL` § `EXE-LOCAL-003` | `EXECUTION-EXECUTION-LOCAL-TECH-DESIGN`<br>`AGENT-DOC-02-05` | `CP-EXE-LOCAL-03` | process/runtime inspection & control | 能发现本机已启动进程与端口；read-only inspect 与 mutation control 权限分离。 |
| `EXE-LOCAL-004` | 接入 Repomix pack/grep/read 的真实 CLI/npm transport | `EXECUTION-TODO-EXECUTION-LOCAL` § `EXE-LOCAL-004` | `EXECUTION-EXECUTION-LOCAL-TECH-DESIGN`<br>`AGENT-DOC-02-05` | `CP-EXE-LOCAL-04` | Repomix Provider Reality | 使用真实 provider transport；outputId 保持 provider-native，不包装 ExecutionRef。 |
| `EXE-LOCAL-005` | 接入 CodeGraph explore 的真实 CLI/可调用 transport | `EXECUTION-TODO-EXECUTION-LOCAL` § `EXE-LOCAL-005` | `EXECUTION-EXECUTION-LOCAL-TECH-DESIGN`<br>`AGENT-DOC-02-05` | `CP-EXE-LOCAL-05` | CodeGraph Provider Reality | 只暴露 explore，禁止 fake HTTP/stub 冒充真实 integration。 |
| `EXE-LOCAL-006` | 完成 Local Tool security/redaction/uncertain mutation recovery | `EXECUTION-TODO-EXECUTION-LOCAL` § `EXE-LOCAL-006` | `EXECUTION-EXECUTION-LOCAL-TECH-DESIGN`<br>`AGENT-DOC-02-05` | `CP-EXE-LOCAL-01`<br>`CP-EXE-LOCAL-06` | security + uncertain mutation | secret/env/path 安全可证明；uncertain mutation 先 reality re-observe，不 blind replay。 |

## 7. Required Failure / Boundary Families

只覆盖 Frozen SDD / §5 Critical Proof 已经存在的失败与边界；不从通用 checklist 新增产品需求。

- [ ] **RF-EXE-LOCAL-01** — workspace/../absolute/symlink/protected path 越界，或 GPT 能覆盖 server-bound workspace
- [ ] **RF-EXE-LOCAL-02** — Local Dev 再次扩成与 Repomix 重叠的广域 pack/grep，或退化成无类型任意 shell
- [ ] **RF-EXE-LOCAL-03** — process list/ports/status 不能观察真实本机状态，或 stop/input 对任意 PID 无边界执行
- [ ] **RF-EXE-LOCAL-04** — Repomix 使用 fake/stub/伪 HTTP provider 升级为 integration PASS，或丢失 provider-native outputId
- [ ] **RF-EXE-LOCAL-05** — CodeGraph `explore` 未证明真实 CLI/transport 就声称可用，或扩张出未冻结 operation
- [ ] **RF-EXE-LOCAL-06** — secret/env 泄漏、bounded output 失效，或 mutation response interruption 后 blind replay




## 8. Evidence Contract

本阶段只冻结**未来必须可观测的 Evidence 类型**；exact fixture / command / actual result / evidenceRef 仍留到开发后 `08-测试用例与验证/`。

- **EV-EXE-LOCAL-01** — 真实临时 workspace 文件/hash/目录状态 + server-bound root observation
- **EV-EXE-LOCAL-02** — Local Dev read/list/search/mutate/run typed request/result 与真实 Git/file reality
- **EV-EXE-LOCAL-03** — process list/ports/status/start/read/input/stop 真实 observation/result
- **EV-EXE-LOCAL-04** — Repomix CLI/npm invocation + pack/grep/read result + provider-native outputId
- **EV-EXE-LOCAL-05** — CodeGraph real invocation + explore result
- **EV-EXE-LOCAL-06** — path/symlink/protected-path rejection
- **EV-EXE-LOCAL-07** — redacted log/env observation
- **EV-EXE-LOCAL-08** — uncertain mutation 后 Git/file/process/port reality re-observation
- **EV-EXE-LOCAL-09** — Direct Tool runtime-schema observation：zero Task/Node/Worker/Execution identity

## 8.1 Critical Proof → Risk → Layer → Evidence Binding

> 本表完成 `Frozen TODO → Critical Proof → Risk → Test Layer → Evidence` 的显式链。RF/EV 只是本文内导航 identity，不是新的产品 Contract/capability。Test Plan Acceptance 仍以 §5 Critical Proof 为准；本文不冻结 TODO priority、dependsOn 或 implementation acceptance。

| Critical Proof | Required Test Layer(s) | Risk / Failure Ref(s) | Required Evidence Ref(s) |
|---|---|---|---|
| `CP-EXE-LOCAL-01` | `Real Local Integration`<br>`Security / Boundary` | `RF-EXE-LOCAL-01` | `EV-EXE-LOCAL-01`<br>`EV-EXE-LOCAL-06` |
| `CP-EXE-LOCAL-02` | `Unit`<br>`Contract / Runtime Schema`<br>`Real Local Integration` | `RF-EXE-LOCAL-02` | `EV-EXE-LOCAL-02`<br>`EV-EXE-LOCAL-09` |
| `CP-EXE-LOCAL-03` | `Real Local Integration`<br>`Failure / Recovery` | `RF-EXE-LOCAL-03` | `EV-EXE-LOCAL-03` |
| `CP-EXE-LOCAL-04` | `Real Local Integration`<br>`Security / Boundary` | `RF-EXE-LOCAL-04` | `EV-EXE-LOCAL-04` |
| `CP-EXE-LOCAL-05` | `Real Local Integration`<br>`Security / Boundary` | `RF-EXE-LOCAL-05` | `EV-EXE-LOCAL-05` |
| `CP-EXE-LOCAL-06` | `Real Local Integration`<br>`Failure / Recovery`<br>`Security / Boundary` | `RF-EXE-LOCAL-06` | `EV-EXE-LOCAL-07`<br>`EV-EXE-LOCAL-08` |

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

当前必须控制的 Module 风险：**Local executor 直接接触真实文件/Git/process/network；路径、secret、重试或 shell 边界错误会造成不可逆本机副作用。**

## 10. Module STOP

出现以下任一情况立即 STOP，不允许 Codex 自行修 Spec：

- 任一 TODO 无法追溯到 Frozen Anchor / sourceRefs / Critical Proof；
- 任一 `REQUIRED` 测试层必须靠新增 Public API、改变 Owner/BC/Contract 才能实现；
- §7 的关键 failure/recovery 在 Frozen SDD 中没有确定语义；
- §8 所需 Evidence 无法从 owner/runtime/reality 观察，只能靠 Mock 自证；
- 真实 External Boundary 只能由 Fake PASS，或 `PENDING_SPIKE` 被当成已验证能力；
- 为了让测试通过必须改变 frozen TODO goal。

若风险“Local executor 直接接触真实文件/Git/process/network；路径、secret、重试或 shell 边界错误会造成不可逆本机副作用。”无法通过当前 Frozen Contract/Boundary 得到可执行证明，标记 `SPEC_GAP` 并停止进入实现。

## 11. 2026-08-14 File materialization Critical Proof Addendum

- [ ] **CP-EXE-LOCAL-08** — external/OpenAI file locator materialization enforces timeout, redirect/private-target rules, size/MIME/hash/path safety and produces bounded typed artifact metadata.
- [ ] **CP-EXE-LOCAL-09** — expired locator/fetch failure does not get interpreted as owner business mutation failure; retry only occurs when transport/effect reality is safe to retry.
- [ ] **CP-EXE-LOCAL-10** — Context Pack construction is node-scoped/bounded, excludes secrets and irrelevant binaries, and does not create a new ContextPack Store/Service.
- [ ] **CP-EXE-LOCAL-11** — Patch materialization and Patch apply are distinct: candidate bytes can exist without implying repo effect success; apply/test Evidence remains Execution-owned.


### Batch 4 Pre-Smoke Patch Effect Closure

- [ ] **CP-EXE-LOCAL-12** — `patch.apply` is a separate Execution capability/effect from `patch-proposal` materialization. It must resolve the durable proposal Artifact, re-hash the bytes, scope-check every target, run live `git apply --check`, cross the Execution effect boundary only after those checks, and reality-verify with reverse-check. Reconciliation must classify `APPLIED / NOT_APPLIED / UNKNOWN`; proposal existence alone is never Effect Evidence.
- [ ] **RF-EXE-LOCAL-12** — same manifest shape with different redacted Context Pack content must produce a different content hash; a stale/conflicting/tampered Patch proposal must fail before mutation, while an ambiguous post-effect state must remain `UNKNOWN` and must not blind replay.

## Batch 4 Pre-Smoke Executable Proof Binding

> 本节绑定本批 Patch/Context Pack 新增行为；实际 PASS 留给本机 targeted verification。

| Proof | Executable asset | Required behavior |
|---|---|---|
| `CP-EXE-LOCAL-12` / `RF-EXE-LOCAL-12` | `packages/execution-local/tests/artifact-context-pack-patch-alignment.test.ts` | Context Pack hash binds redacted content; Patch proposal and apply are separate; live `git apply --check`; post-effect reverse-check resolves APPLIED/NOT_APPLIED/UNKNOWN without blind replay |
| verification separation | `packages/execution-runtime/tests/execution-artifact-pipeline.test.ts` | Patch apply may remain `SUCCEEDED+APPLIED` while later `quality.test` independently becomes `FAILED+NOT_APPLIED`; verification failure cannot rewrite historical effect truth |

## 2026-09-09 Provider Reality / Interface Minimization Gate

- [ ] **CP-EXE-LOCAL-13** — Provider Reality Gate 必须分别证明 Repomix、CodeGraph、Local Dev implementation 的实际 binary/npm/CLI/API、启动方式、auth（如有）、输入输出和 lifecycle；未证明不得用 stub 宣称 integration ready。
- [ ] **CP-EXE-LOCAL-14** — Local Dev `search` 是本机文件/文本精确检索，不重建 Repomix pack/grep 的跨仓库上下文聚合；重复能力应删除而不是并存两套语义。
- [ ] **CP-EXE-LOCAL-15** — Direct Tool entrypoint 不要求 `executionRef/taskId/nodeId/workerRef`；internal Execution entrypoint 如复用 execution-local primitive，必须使用独立 adapter/type，不得污染 Direct Tool DTO。
- [ ] **CP-EXE-LOCAL-16** — provider-native long operation 必须在 OpenAI 45s 边界内返回 bounded result/native handle，或在 Provider Reality Gate 阶段判定该 operation 不适合作为 v1 Action；不得新增通用 Execution polling 兜底。

**Executable proof**：`packages/execution-local/tests/direct-tools.test.ts` + `packages/execution-local/tests/execution-local-critical-proofs.test.ts`。

代码变更前只更新 Test Plan；`08-测试用例与验证` 与 executable inventory 暂不修改。

## 独立审计补充：入口、Provider、命令安全

以下细化 CP-EXE-LOCAL-01/03/06/13/15/16：

- Direct public entrypoint 的完整传递 import graph 无 Execution DTO/store/lifecycle；internal adapter 对同一 primitive 的真实调用仍成立。只查 Direct 入口文件不充分。
- Repomix 在真实临时仓库 pack→grep/read，对照磁盘内容/hash；跨 Role/Workspace outputId 拒绝，过期/丢缓存不升级为 Execution polling。CodeGraph 对含已知 caller/callee 的真实小仓库 explore；修改后测试 freshness/索引失败，不能把 mock graph 当 Provider PASS。
- 固定 Provider version、license、npm public API/CLI、Node 24 与 macOS x86_64；warm/cold 各一次，记录安装与运行事实，不改为 MCP transport。
- 真实验证 file symlink/parent replacement/protected path；command profile 反例包括 node/python 任意代码、package lifecycle/Git hook、env loader/preload、可执行文件替换。获准 repo script 继承 OS 用户权限，不以脚本内部无法访问 Workspace 外作为验收；明确外部 path/cwd/文件参数在 Effect 前提示实际规范化目标，提示后无需批准即可执行；验证没有批准交互也可完成，目标变化提示随之更新。另行验证身份、digest、generation 和 deadline 的 Effect Gate 拒绝规则，危险操作独立确认不被越界提示绕过。
- managed processRef 测试 PID 复用、跨 Role、外部 PID input/stop、输出超过上限、child tree cleanup 与句柄失效；只读 list/ports 与控制权限独立。
- 同一 command 的重复 execute、dispatch 后断线、超时后迟到结果不得二次 effect；unknown 后 read/git diff/status 是新观察，不是旧 command 重发。

本 Module 管理 process handles 与 Provider caches，故 Concurrency / Idempotency 层为 REQUIRED（范围仅原生 handle/并发执行安全，不新增 Execution lifecycle）；Stability / Performance 为 REQUIRED（bounded output/deadline/provider isolation）。Provider child 的模块启动关闭验证归 Extension Test Plan，Local Dev 自己启动的 process 行为归本模块。

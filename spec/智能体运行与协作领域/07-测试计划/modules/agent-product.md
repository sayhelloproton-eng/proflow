---
docId: TP-MODULE-AGENT-PRODUCT
title: agent-product｜开发前 Module Test Plan
docType: test-plan
authority: normative
lifecycle: active
domain: agent-runtime-collaboration
subdomain: null
subdomains: []
boundedContext: agent-runtime-collaboration
moduleRef: agent-product
provides: []
requires: []
contractRefs: []
testPlanPhase: PRE_IMPLEMENTATION
testPlanStatus: FINAL_FROZEN
sourceRefs:
- AGENT-DOC-04-00
- AGENT-DOC-02-03
- AGENT-DOC-03-06
- AGENT-DOC-05-03
implementationWave: Wave 4
---

# `agent-product`｜开发前 Module Test Plan

## 1. Risk

Product GPT最容易重新吸收New Task ownership、Role discovery或把Conversation文本当Task truth。v1必须证明Extension-first New Task与Product Worker职责分离。

## 2. Required Layers

- Package/Static Artifact Conformance
- Contract/OpenAPI
- Module Behavior
- Cross-domain Integration
- Real Custom GPT E2E
- Security/Boundary

## 3. Critical Proofs

- [ ] **CP-AGT-PROD-01** — metadata/Instructions固定generic Product职责；Knowledge specialization不进入v1。
- [ ] **CP-AGT-PROD-02** — Static Actions不含`createTask/listRegisteredRoles/getRegisteredRole`主链，只含Product business-purpose operations。
- [ ] **CP-AGT-PROD-03** — Extension先createTask(PENDING)，Browser CREATE/observe Product Conversation后bind；workerRef/c-id不猜测/不复用旧Task。
- [ ] **CP-AGT-PROD-04** — Product bound后即可Requirement discussion/write；Dev/Test teaming可后台继续，Task READY仍要求三binding+Requirement。
- [ ] **CP-AGT-PROD-05** — one Worker Turn支持0..N Actions；Conversation context/native File Bridge/CI/Web Search按规则使用；无Browser per-action continue。
- [ ] **CP-AGT-PROD-06** — real GPT behavior/auth/Always Allow/File Bridge与package边界一致，Task formal truth只由Task Action产生。

## 4. Failure Families

- Product Action surface重新出现createTask/dynamic role discovery；
- Product Conversation先于Task成为无主Worker；
- workerRef/c-id猜测或复用其它Task；
- Requirement只存在Conversation未写TaskDocument；
- Browser注入完整PRD代替File Bridge；
- GPT自然语言“需求完成”直接改变Task；
- Always Allow被误当Execution Approval。

## 5. Real / Fake Boundary

Package/OpenAPI可静态测试；workerRef/c-id、Custom GPT Action auth、Always Allow/File Bridge行为必须真实Browser/Custom GPT验证。静态fixture不能替代。

## 6. Evidence

```text
package/OpenAPI conformance
Product Action operation list
Task(PENDING) before Worker bind owner snapshot
Browser observed workerRef/conversation locator
TaskRoleBinding result
Requirement TaskDocument ref
multi-action Conversation trace
real GPT auth/File Bridge/permission observation
```

## 7. GO / STOP

GO：所有Critical Proof可由现有Frozen Contract表达。  
STOP：为通过测试需要恢复Product createTask主链、dynamic Role类型、或Browser业务判定。

## 2026-08-15 Pre-Smoke Batch 2｜Local Role CLI Addendum

- [ ] **CP-AGT-PROD-07** — Product Role Package CLI 暴露 `role register/show/list/validate/delete` 与 `role key show/rotate`，通过 Agent owner composition 工作，不读取 Task SQLite/credential implementation files 作为第二事实源。
- [ ] **RF-AGT-PROD-07** — Role CLI surface 缺命令、直接写 Task DB、或绕过受认证的 local management boundary。

**Executable proof**：`packages/agent-product/tests/current-spec-alignment.test.ts` 的 `PRESMOKE-B2 role package CLI...`。

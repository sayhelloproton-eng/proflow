---
docId: TP-REAL2-CUSTOM-GPT-DEPLOYMENT-PROVISIONING
title: Real-2｜Custom GPT Deployment Provisioning Test Plan
docType: test-plan
authority: normative
lifecycle: active
domain: agent-runtime-collaboration
boundedContext: agent-runtime-collaboration
moduleRef: null
testPlanPhase: PRE_IMPLEMENTATION
testPlanStatus: FINAL_FROZEN
sourceRefs:
- AGENT-DOC-04-00
- AGENT-DOC-02-02
- AGENT-DOC-03-01
- EXECUTION-EXECUTION-BROWSER-EXTENSION-TECH-DESIGN
---

# Real-2｜Custom GPT Deployment Provisioning Test Plan

## 1. Scope

证明平台部署期可以在不依赖 Custom GPT management API、不引入模型页面决策、也不修改运行期 Task/Worker/J1-J6 语义的前提下，自动创建并配置三个真实 Private Custom GPT，注册真实 Role、动态配置 role credential，并在 Fresh Workspace 中达到可验证的 Role READY。

本计划只覆盖 Deployment Provisioning；运行期 Conversation CREATE/RESTORE/WAKE、Task Observer、Collaboration、Browser Effect/Recovery 继续由既有 Execution/Agent Test Plan 验收。

## 2. Preconditions

- 三个 Agent Package 已安装，并能 materialize 完整 provisioning material。
- Agent Gateway public URL 已成为可机器读取的 workspace shared fact。
- `execution-browser-extension` 已由用户完成唯一必要的人工作业：在真实 Chrome profile 加载 unpacked extension。
- Extension 与 Mac setup bridge 通过独立 local credential 完成真实 hello + heartbeat。
- ChatGPT editor 当前账号 reality 允许创建/更新 Private GPT；否则必须显式 ACTION_REQUIRED/FAILED。
## 3. Critical Proofs

- [ ] **CP-REAL2-PROV-01** — 三个 Agent Package 均能 materialize `displayName/description/instructions/starters/recommendedModel/capabilities/actionSchema/knowledgeBundle`；当前 `recommendedModel=gpt-5-6`，Knowledge Bundle 固定路径为 `knowledge/custom-gpt-knowledge.zip`。
- [ ] **CP-REAL2-PROV-02** — Knowledge ZIP 在 Mac 侧安全解包，拒绝 traversal/symlink escape/不支持 MIME/大小越界；Extension 只接收 staged bounded files，不解释 Knowledge 语义。
- [ ] **CP-REAL2-PROV-03** — Provisioning 与运行期 Browser Carrier 隔离：`/gpts/editor/*` 使用独立 content/command/state machine；Provisioning DTO 不含 taskId/nodeId/workerRef/conversationLocator/executionRef。
- [ ] **CP-REAL2-PROV-04** — 用户加载 unpacked extension 后，Mac CLI 通过真实 authenticated hello + heartbeat 自动识别 READY；禁止手工声明 Service Worker RUNNING 作为证明。
- [ ] **CP-REAL2-PROV-05** — Extension-native Driver 确定性填写 Name/Description/Instructions/Starters、上传 Knowledge、选择 `gpt-5-6`、设置 required Capabilities、安装 Action Schema，并逐项 readback/reality verify；不使用模型或固定坐标。
- [ ] **CP-REAL2-PROV-06** — GPT 以 `private / 只有我` 创建；promote/live reality 成功后返回真实 g-id/carrierUrl；创建失败时不得先注册 Role。
- [ ] **CP-REAL2-PROV-07** — Agent Domain 使用真实 g-id 执行 `registerRole`，生成一 Role 一 credential；Extension 不生成、不拥有 Role secret。
- [ ] **CP-REAL2-PROV-08** — 动态 role credential 仅通过本次受限本地 provisioning transport 交给 Extension 机械填入 API Key/Bearer；不得进入 extension static assets、chrome.storage、runtime config、log/evidence。
- [ ] **CP-REAL2-PROV-09** — setup 可重入：中断/reload/CLI 重跑只补 missing/drift；已正确绑定的 live GPT 走 UPDATE/verify，禁止重复创建第二个 GPT/Role。
- [ ] **CP-REAL2-PROV-10** — Fresh Workspace 最终真实创建 Product/Controller-Dev/Test-Ops 三 GPT，三个 durable Role/credential 均存在，Knowledge smoke 可证明生效，至少一个真实 GPT→Gateway 身份探针 PASS，reopen 后仍 READY。
- [ ] **CP-REAL2-PROV-11** — Provisioning 增量对既有 `/g/*` Runtime Carrier、Task Observer、Worker CREATE/RESTORE/WAKE、Collaboration 与 Browser Effect/Recovery 回归零语义变化。

## 4. Required Failure Boundaries

- [ ] **RF-REAL2-PROV-01** — Extension 未加载/heartbeat stale/bridge auth invalid 必须阻塞，不得伪造 READY。
- [ ] **RF-REAL2-PROV-02** — GPT editor selector/DOM contract 漂移时 fail closed，禁止坐标猜测或模型自由点击。
- [ ] **RF-REAL2-PROV-03** — 恶意/损坏 Knowledge ZIP、越界文件或 unsupported carrier file 必须在上传前拒绝。
- [ ] **RF-REAL2-PROV-04** — create/promote reality 未确认时禁止 `registerRole`；Role 注册后 Auth Update 失败必须保持可恢复的 NOT_READY，而不是假 PASS。
- [ ] **RF-REAL2-PROV-05** — 任意 Role credential 出现在日志、Evidence、runtime config、chrome.storage 或静态扩展包即 FAIL。
- [ ] **RF-REAL2-PROV-06** — setup 重试产生 duplicate GPT/roleRef 或覆盖其它 Agent Package Role 即 FAIL。
- [ ] **RF-REAL2-PROV-07** — Provisioning 通过 Task/Worker/Execution runtime state machine 驱动或改变其业务事实即架构回归 FAIL。
## 5. Real / Fake Boundary

Unit/TDD 可 fake DOM、Chrome API、bridge transport 和 package files；但以下最终验收不得只 fake：真实 Chrome Extension heartbeat、真实 `/gpts/editor` DOM、Knowledge upload processing、model/capability readback、private create/promote、真实 g-id/live reality、真实 Role registration/credential、真实 Gateway auth probe、extension reload/reopen recovery。

Playwright Chrome MCP 只作为开发探路/观测工具，不能作为 ProFlow 产品路径的 PASS 证据。

## 6. Evidence

```text
Agent Package provisioning material snapshot + hashes
Knowledge ZIP validation/staging manifest
Extension hello/heartbeat identity evidence
Provisioning command/result trace without secret
Editor field readback + Knowledge processing evidence
private promote/live g-id evidence
Role Registry owner readback
secret-store existence/permission proof without raw key
Gateway authenticated harmless probe
setup retry/reopen no-duplicate proof
runtime J1-J6 regression proof
```

## 7. GO

`REAL2_PROVISIONING_GO = YES` 只有在 CP-REAL2-PROV-01..11 全部有对应 executable/real evidence、RF-REAL2-PROV-01..07 均被 fail-closed 证明，且三个真实 Role 在 Fresh Workspace reopen 后仍 READY 时成立。任何页面自动填充 feasibility、mock create 或仅本地 Role Registry 均不能替代该结论。

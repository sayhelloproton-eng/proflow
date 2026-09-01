---
docId: TP-REAL2-CUSTOM-GPT-DEPLOYMENT-PROVISIONING
title: Real-2｜Custom GPT Deployment Provisioning Test Plan
docType: test-plan
authority: normative
lifecycle: active
domain: agent-runtime-collaboration
boundedContext: agent-runtime-collaboration
moduleRef: null
testPlanPhase: FINAL_ACCEPTANCE
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

- [x] **CP-REAL2-PROV-01** — 三个 Agent Package 均能 materialize `displayName/description/instructions/starters/recommendedModel/capabilities/actionSchema/knowledgeBundle`；最终角色名为 `运营 + 产品经理 / 研发 + 项目总控 / 部署 + 测试验收`，`recommendedModel=gpt-5-6`，三项 capability 全部开启，Knowledge Bundle 固定为 `knowledge/custom-gpt-knowledge.zip`。
- [x] **CP-REAL2-PROV-02** — Knowledge ZIP 在 Mac 侧先做结构、traversal、内部文件类型、单项大小与总大小校验；校验通过后 relay/upload 的最终 Knowledge artifact 是 ZIP 本体 `custom-gpt-knowledge.zip`，不再把解包后的 `.md` 逐文件作为正常上传物。
- [x] **CP-REAL2-PROV-03** — Provisioning 与运行期 Browser Carrier 隔离：`/gpts/editor` / `/gpts/editor/*` 使用独立 content/command/state machine；Provisioning DTO 不含 taskId/nodeId/workerRef/conversationLocator/executionRef。
- [x] **CP-REAL2-PROV-04** — Extension 通过真实 authenticated hello + heartbeat 被机器识别 READY；禁止手工声明 Service Worker RUNNING 作为证明。测试期 Reload 可由自动化执行，真实产品首次安装仍服从 Chrome Extension 安全边界。
- [x] **CP-REAL2-PROV-05** — Extension-native Driver 确定性填写 Name/Description/Instructions/Starters、上传 ZIP Knowledge、选择 `gpt-5-6`、设置三项 Capabilities、安装 Action Schema、配置 API Key/Bearer，并逐项 readback/reality verify；不使用模型或固定坐标。
- [x] **CP-REAL2-PROV-06** — GPT 以 `private / 只有我` 创建；live reality 成功后返回真实 g-id/carrierUrl；创建失败时不得持久化新的 current Role。
- [x] **CP-REAL2-PROV-07** — Agent Runtime 在 Create 前预生成 candidate credential但不落盘；真实 g-id 成功后 `saveCurrentRole` 将同 package current Role/credential 原子替换，其他 package 不变；普通 `registerRole` 重复拒绝语义保留。
- [x] **CP-REAL2-PROV-08** — candidate credential 只通过本次受限本地 provisioning transport 交给 Extension，并在同一 GPT Editor、Create 之前机械填入 API Key/Bearer；不得进入 extension static assets、chrome.storage、runtime config、log/evidence。重开 Auth UI 时 secret 以 `[HIDDEN]` 表示已保存，不回显原值。
- [x] **CP-REAL2-PROV-09** — `Module.setup` 对 `READY` current Role 直接复用，对 `MISSING` 才自动创建，对 `DRIFT` fail closed 且不 Edit 旧 GPT；上层显式调用公共 `createCustomGptRole` 时每次都创建新的 GPT，并以 `saveCurrentRole` 覆盖同 package current binding。workspace 内创建队列串行，前序失败不毒化后序。
- [x] **CP-REAL2-PROV-10** — Real-1 已独立证明 Registry/Fresh Workspace 部署合同；Real-2 在与 Gateway 相同 authoritative workspace scope 中真实创建三个 Private GPT，最终 `ROLE_COUNT=3`，三个 current Role 均使用 ZIP Knowledge、三项 capability 与 Bearer Auth，并通过 Role/Gateway 验证。Real-2 不重复承担 Real-1 的 Fresh Workspace 安装验收。
- [x] **CP-REAL2-PROV-11** — Provisioning 增量对既有 `/g/*` Runtime Carrier、Task Observer、Worker CREATE/RESTORE/WAKE、Collaboration 与 Browser Effect/Recovery 回归零语义变化；Extension targeted suite 与三个 Agent package suites/typecheck 均通过。

Executable mapping：`packages/execution-browser-extension/tests/custom-gpt-provisioner.test.ts`、`packages/execution-browser-extension/tests/custom-gpt-editor-driver.test.ts`、`packages/execution-browser-extension/tests/custom-gpt-knowledge.test.ts`、`packages/execution-browser-extension/tests/custom-gpt-role.test.ts`、`packages/execution-browser-extension/tests/deployment-provisioning-boundary.test.ts`、`packages/agent-runtime/tests/agent-runtime-critical-proofs.test.ts`、`packages/agent-product/tests/agent-product-static.test.ts`、`packages/agent-controller-dev/tests/agent-controller-dev-static.test.ts`、`packages/agent-test-ops/tests/agent-test-ops-static.test.ts`。

## 4. Required Failure Boundaries

- [x] **RF-REAL2-PROV-01** — Extension 未加载/heartbeat stale/bridge auth invalid 会阻塞 provisioning，不伪造 READY；pairing/bridge executable tests 已覆盖。
- [x] **RF-REAL2-PROV-02** — GPT editor selector/DOM contract 漂移时 fail closed；真实 UI 漂移曾分别触发明确错误并通过截图/DOM 修正，正常实现不使用坐标猜测或模型自由点击。
- [x] **RF-REAL2-PROV-03** — 恶意/损坏 Knowledge ZIP、traversal、内部 unsupported file type、大小越界会在上传前拒绝；ZIP 本体上传不取消内部安全校验。
- [x] **RF-REAL2-PROV-04** — Create/live reality 未确认时禁止 `saveCurrentRole`；candidate credential 在 Create 前只存在内存。`LIVE_CREATED` 一旦真实成立并完成 `saveCurrentRole`，远端 GPT 已成为不可逆物理事实：后续 Gateway/Carrier validation 失败不得 rollback durable Role，也不得把它重新视为 `MISSING` 后重复创建。Module 保留同一 roleRef/credential，明确保持非 READY，并在下一次 setup 仅重做只读 validation；validation PASS 后写入与 `agentPackageRef + registeredPackageVersion + roleRef + carrierUrl + gatewayUrl` 精确绑定、且不含 secret 的 evidence。任一绑定事实变化使 evidence stale 并要求重新 validation。
- [x] **RF-REAL2-PROV-05** — Role credential 不进入日志、Evidence、runtime config、chrome.storage 或静态扩展包；真实验证只检查状态/掩码 `[HIDDEN]`，不读取或打印 secret。
- [x] **RF-REAL2-PROV-06** — `Module.setup` READY 重跑不重复创建；显式 recreate 只覆盖同 package current binding，其他 Agent Package Role 不变；同 workspace queue 串行且失败不毒化后序。
- [x] **RF-REAL2-PROV-07** — Provisioning 与 Task/Worker/Execution runtime 状态机保持隔离，Provisioning DTO 与 surface 静态测试持续禁止 runtime business vocabulary。

Executable mapping：`packages/execution-browser-extension/tests/browser-extension-pairing.test.ts`、`packages/execution-browser-extension/tests/custom-gpt-knowledge.test.ts`、`packages/execution-browser-extension/tests/custom-gpt-role.test.ts`、`packages/execution-browser-extension/tests/deployment-provisioning-boundary.test.ts`、`packages/agent-runtime/tests/agent-runtime-critical-proofs.test.ts`。
## 5. Real / Fake Boundary

Unit/TDD 可 fake DOM、Chrome API、bridge transport 和 package files；最终验收已使用真实 Chrome Extension heartbeat、真实 `/gpts/editor` DOM、ZIP Knowledge upload、model/capability readback、private create、真实 g-id/live reality、真实 Role/credential、真实 Gateway probe；2026-09-01 Fresh Deployment regression 进一步证明 post-create validation rollback 会遗失不可逆远端 GPT authority，因此恢复合同改为 durable Role + retryable validation evidence。

Playwright Chrome MCP 在验收中只作为 observer/screenshot/DOM/console 辅助取证；所有 GPT Editor 产品动作均由 ProFlow Extension 自己执行，MCP 没有代替产品填写或点击。

## 6. Evidence

```text
三个 Agent Package material/static tests：12/12、15/15、14/14 PASS
Execution Browser targeted suite：86/86 PASS + typecheck PASS
Agent Runtime：Role persistence / carrier validation targeted proofs PASS；post-LIVE_CREATED validation failure 保留 current Role，validation evidence 精确且无 secret
真实 Product/Controller/Test-Ops Private GPT 创建 = PASS
最终 current Role：3 个 package / 3 个 distinct g-id / ROLE_COUNT=3
Knowledge UI：custom-gpt-knowledge.zip / application/zip
Capabilities UI：webSearch/imageGeneration/codeInterpreter = true/true/true
Auth UI：API Key + Bearer，重开 secret 显示 [HIDDEN]
同 package 连续 3× explicit recreate：每次新 g-id，current binding 始终只有 1 条
同 workspace queue 串行 + 前序失败隔离 = PASS
Gateway local/public health 与 authenticated role probe = PASS
失败路径：Create 前失败不产生 Role；LIVE_CREATED 后 validation failure 保留新 durable Role、保持非 READY，并只重试 validation，禁止重复 create
working tree 在最终 Real-2 文档冻结前 CLEAN
```

## 7. GO

截至 2026-08-25，CP-REAL2-PROV-01..11 与 RF-REAL2-PROV-01..07 已完成 executable/real evidence 对齐。Real-1 已独立承担 Registry/Fresh Workspace 安装验收，Real-2 不重复该阶段职责；Real-2 以真实同-scope workspace 的三个 Private GPT、Role/Auth/Gateway 与覆盖/回滚证据作为最终 Worker Identity 验收。

```text
REAL2_PROVISIONING_GO = YES
REAL_2 = PASS
READY_FOR_REAL_3 = YES
```

只有新的、可复现的真实 regression evidence 才允许重新打开本计划。

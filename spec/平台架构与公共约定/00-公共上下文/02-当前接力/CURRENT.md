# CURRENT｜Phase 3 当前接力

> 更新时间：2026-09-06。这里是下一 Chat 的唯一滚动执行入口；历史证据只在 `90-历史记录`。

## CURRENT_STAGE

```text
ARCHITECTURE = FROZEN
REAL_1 = PASS
REAL_2 = PASS / FROZEN
DEPLOYMENT_SUCCESS = YES / FROZEN
CURRENT_EXECUTION_GATE = REAL_3_J4
J1 = PASS
J2 = PASS
J3 = PASS
J4 = IN_PROGRESS
REAL_3 = NOT_PASS
PHASE3_FINAL_GO = NO
```

## FINAL_GOAL

完成固定 Real-3 Task 的 J4：Dev 通过正式 Execution 读取 `repos/proflow/package.json` 并完成节点；随后 Test/Ops 自动收到下一节点 WAKE、独立读取同一文件并完成；最终 Task Owner 必须为 `SUCCEEDED / currentNodeId=null`。已经 PASS 的 J1/J2/J3 不重跑。

## CURRENT_AUTHORITY

```text
branch = main
HEAD = 8c0080f chore(release): version execution-browser-extension
working tree = DIRTY / scripts/human-e2e/browser-extension-ui.swift + CURRENT.md + untracked Real3/22 history evidence
agent-gateway repo version = 0.1.15
execution-browser-extension = 0.1.44 / Registry + Workspace + materialized + Chrome actual adoption PASS
Chrome Extension ID = eehdadpmjffomabiedcjijiakconalab
platform setup = 3/3
platform start = 4 success / 19 skipped / 0 failed
Browser Carrier = online / sessionOnline=true / commandConsumerReady=true
Model Runtime = READY / fast READY / reason READY
Execution Runtime = READY / browserExecutor READY / modelDecision READY
Platform Host /ready = 200 / Task+Agent+Execution+Model all READY
Agent Gateway /health = 200
Agent Gateway /ready = 503 / credentialStore=true / downstream=false / ingress=true / relay=true
```

## J3_FINAL_EVIDENCE

J3 已正式 PASS，不允许再次 Recover/replay WAKE：

```text
wake execution = execution:fbc00b27-bf5b-4325-a3ef-4269579fdabd
08:21:06 EXECUTION_REDECISION_REQUESTED
08:21:15 EXECUTION_STARTED
08:21:23 EFFECT_STARTED
08:21:29 EXECUTION_SUCCEEDED
```

Chrome 当时存在两张同 URL 的 Dev Conversation。Execution 命中的真实目标是标题 `研发 + 项目总控 - 确认绑定状态` 的原始 Conversation；该页已真实出现 `proflow.agent.browser-trigger.v1 / NODE_READY / dev / runNo=1` user message，随后 Dev Worker 明确回复“NODE_READY 已处理，dev 节点已正式启动并绑定到指定 worker”。因此 `Browser API success != message submit` 的 J3 最终门禁已由真实 DOM + Execution Owner 双证据满足。

## J4_CURRENT_OWNER_TRUTH

2026-09-06 最后一次 Tasks fresh refresh + reselect：

```text
Task = task-a6f859c00b1accd027d53d48
Task status = WAITING
Task version = 9
Dev / Implement = WAITING / run 1
Test / Verify = PENDING / run 1
Browser Carrier = online / sessionOnline / commandConsumerReady
```

Dev Worker 在收到 NODE_READY 后已经成功进入 J4/startNode；随后按 Task 目标尝试通过正式 Execution 读取 `repos/proflow/package.json`，但 Custom GPT Action 返回 `GATEWAY_FAILURE`。Dev 没有猜测 name/version，而是把节点正式置为 WAITING，原因语义为 `EXECUTION_GATEWAY_FAILURE`。Test 尚未获得 READY/NODE_READY。

## CURRENT_PROBLEM

```text
problem class = REAL3_J4_EXECUTE_CAPABILITY_PRE_EXECUTION_FAILURE
primary owner = NOT_FROZEN / boundary = Agent Gateway downstream route → Platform Host /actions/executeCapability → Execution admission
FIRST_DIVERGENCE = executeCapability-specific path before durable Execution creation
J4 failure = GATEWAY_FAILURE
```

上一轮 `actionTimeoutMs=undefined` root-cause 判断已被当前机械 authority **证伪**，不得据此修改或发布 Agent Gateway：

1. 当前 HEAD `8c0080f` 的 `packages/agent-gateway/src/index.ts` 实际执行 `AbortSignal.timeout(options.actionTimeoutMs ?? 45_000)`；该 fallback 自 commit `45b2a97` 已存在，并非本轮未提交修复。
2. `packages/agent-gateway` 当前无 working-tree diff；repo dist 与 Product Workspace `@tomflow/proflow-agent-gateway@0.1.15` 的 `dist/src/index.js` 都包含同一 `?? 45_000`，且 SHA-256 完全一致。
3. 现有 `agent-gateway-process.test.ts` 已通过正式 `createAgentGatewayProcess()` 发起 `/actions/getTask` 并断言 downstream 收到 authenticated role/input，已经覆盖“正式 process action 能进入 downstream”。
4. 当前 live read-only `getTask` 通过同一 Agent Gateway 返回 HTTP 200，并回读 fixed Task `WAITING / v9`。
5. 同一 Dev J4 Turn 中 `startNode` 已成功，失败后 `waitNode` 也成功；两者与 `executeCapability` 共用同一 Gateway action handler，因此 generic action-timeout composition 不可能只让中间一次 `executeCapability` 失败。
6. Execution Owner SQLite 当前没有本次 package.json read 对应的新 durable Execution；最新仍是 J3 `worker.wake`，说明失败发生在 durable Execution 创建之前。

因此当前唯一有效结论是：**`executeCapability` 特有路径在 `Agent Gateway downstream route → Platform Host /actions/executeCapability → Execution admission` 边界内、durable Execution 创建前失败；具体 owning root cause 尚未冻结。** 下一步只能继续只读定位该边界，禁止创建新 Execution 来“重试看看”。

`Agent Gateway /ready=503 downstream=false` 仍是独立邻接诊断现象；readiness probe 的 2 秒 timeout 不得顺手修改，除非新的 SAME-SCENE evidence 证明它成为 blocker。

## REPAIR_STATE

```text
BATCH_ID = REAL3_J4_EXECUTE_CAPABILITY_PRE_EXECUTION
BATCH_CONTEXT = IN_PROGRESS
ROOT_CAUSE_CONFIRMED = NO
SOURCE_TRANSFORM = NOT_AUTHORIZED
FIX_DESIGN_FROZEN = NO
PREVIOUS_ROOT_CAUSE = INVALIDATED_BY_CURRENT_GIT_WORKSPACE_RUNTIME_EVIDENCE
```

## NEXT_ACTION

1. 继续只读定位 `executeCapability` 特有边界：读取 Platform Host action dispatcher、Execution contract/admission 与相关 tests，确认请求从 authenticated role 到 Execution Runtime 前的机械 transform/validation/error mapping；不得创建新 Execution 做探测。
2. 优先从既有 Dev Conversation、Task Owner、Execution Owner 与当前源码恢复那次失败的请求语义；定位 durable Execution 创建前的 FIRST_DIVERGENCE，并冻结唯一 owning package。
3. 只有 root cause 由机械 evidence 成立后，才开启产品修复 Batch：最小源码 + regression → owning package targeted gate / package gate → 按影响补 build → `git diff --check`。
4. candidate PASS 后按实际 owning package 走 `Package-Update-Loop`：release patch → Registry exact → `platform update --package <target>` → runtime readback；不得预设 target 仍是 Agent Gateway。
5. 回 SAME-SCENE J4。先读 Task Owner，确认仍是 Task WAITING / Dev WAITING run1 / Test PENDING run1；再按正式 WAITING/resume 语义恢复当前 Dev turn。**不要点 Reopen，除非 Task Orchestration 明确要求新 run。**
6. Dev 必须通过正式 Execution 真读 `repos/proflow/package.json` 并报告 package name/version，然后 completeNode。
7. 证明 Test 自动进入 READY/NODE_READY；Test 独立通过 Execution 读取同一文件并 completeNode。
8. 最终只在 Task Owner `SUCCEEDED / currentNodeId=null` 且两次真实 read evidence 完整时宣告 `REAL_3=PASS`。

## FIXED_REAL3_RESOURCES

```text
Task = task-a6f859c00b1accd027d53d48
Product role/worker = g-6a97182669f88191a943e806a3e1b42a / 6a9b243c-7af8-83e9-a005-2ccfb8c5c8cb
Dev role/worker = g-6a9717f68ef081918aacd5911916d2ec / 6a9b4632-ca8c-83e9-a4bc-9de9e229e515
Test role/worker = g-6a97186190108191bc24fb85b2cff584 / 6a9b8ae0-f694-83e8-b4a2-0d20cbc5c04a
J3 wake execution = execution:fbc00b27-bf5b-4325-a3ef-4269579fdabd / SUCCEEDED
```

禁止创建新 Task/GPT/Worker/Execution；禁止重新 Human Start、再次 WORKER_BIND/browser.bindWorker、再次 Recover missing Workers 或重发 J3 WAKE。

## DO_NOT_REPEAT

- J3 已 PASS；不再调查 composer、OBSERVE、identity、Model Decision、Browser pairing，除非出现新的可复现 regression evidence。
- 不再发布/update `execution-browser-extension 0.1.44`；Registry/Workspace/materialized/Chrome actual 均已闭环。
- 不再 Recover missing Workers；同一个 durable WAKE 已 `EXECUTION_SUCCEEDED` 且真实 Dev Conversation 已收到 NODE_READY。
- 不以当前 Playwright 是否正控制哪一张同 URL Dev tab 判断 J3；真实 target 已确认是标题 `研发 + 项目总控 - 确认绑定状态` 的 Conversation。
- 不因 Agent Gateway `/ready downstream=false` 单独扩大 readiness/Tunnel/Model；当前 action-timeout root cause 已被证伪，诊断只沿 `executeCapability` 特有的 pre-Execution boundary 前进。
- 不直接改 Task DB/.proflow，不伪造 package.json read evidence，不手工把 Dev WAITING 改回 READY。
- 当前未提交 `scripts/human-e2e/browser-extension-ui.swift` 只是 Browser Harness `inspect-extension-geometry` 增强；不要误当 Agent Gateway candidate，也不要在 Gateway 产品提交中夹带。

## REQUIRED_CONTEXT

完成 Core 读取后，下一 Chat 第一轮只额外读取：

1. `03-自动化知识库/基础动作/Chat-高吞吐本地工程执行.md`
2. `03-自动化知识库/基础动作/Targeted-Gate.md`
3. `03-自动化知识库/流程/Package-Update-Loop.md`
4. `03-自动化知识库/基础动作/npm发布与Registry回读.md`
5. `03-自动化知识库/流程/Real3-J0-J4.md`

当前没有任何产品源码修改授权：root cause 尚未冻结。只读诊断范围已收缩为 `Agent Gateway downstream route → Platform Host /actions/executeCapability → Execution admission`；按新 evidence 扩到该最小边界，禁止重新 full-repo 探索。

### ON_DEMAND_CONTEXT

- 修复发布后，在恢复 Dev `WAITING/run1` 前，再按需读取 `spec/任务与编排领域/` 中 WAITING/resume/runNo 的正式语义；不得把 Reopen 当默认恢复动作。
- MCP/Playwright/Local Dev runtime 异常才读 `03-自动化知识库/基础动作/Tool-Runtime-gptweb-mcp.md`。
- 需要追本轮原始 evidence 才读 `90-历史记录/Real3/22-Real3-J3终局与J4-Gateway阻塞-20260906.md`。

## STOP_POINT

`J1_PASS / J2_PASS / J3_PASS / TASK_WAITING_V9 / DEV_WAITING_RUN1 / TEST_PENDING_RUN1 / J4_GATEWAY_FAILURE / PREVIOUS_GATEWAY_TIMEOUT_ROOT_CAUSE_INVALIDATED / EXECUTE_CAPABILITY_PRE_EXECUTION_DIAGNOSIS / SOURCE_TRANSFORM_NOT_AUTHORIZED`。

下一 Chat **不要从聊天记忆直接执行**；先完成固定 Core + REQUIRED_CONTEXT，再从 `executeCapability` pre-Execution diagnosis 继续。

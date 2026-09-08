# CURRENT｜Phase 3 当前接力

> 更新时间：2026-09-08。这里是下一 Chat 的唯一滚动执行入口；已消费 Round / acceptance / 原始 evidence 见 `90-历史记录/Real3/27-Real3-J4-0.1.50采用到ProductionStart-DevTunnel失败-CURRENT快照-20260908.md`。

## CURRENT_STAGE

```text
ARCHITECTURE = FROZEN
REAL_1 = PASS
REAL_2 = PASS / FROZEN
DEPLOYMENT_SUCCESS = YES / FROZEN
J1 = PASS
J2 = PASS
J3 = PASS
J4 = PAUSED_FOR_INTEGRATION_HARDENING
REAL_3 = NOT_PASS
PHASE3_FINAL_GO = NO
CURRENT_EXECUTION_MODE = REAL_3_J4_DEV_TUNNEL_AUTH_RECOVERY_PENDING
```

## CURRENT_AUTHORITY

当前 Git HEAD / worktree 必须在每次接管时机械回读，本文不把嵌入 commit hash 当实时 Git authority。最近一次公共上下文事实提交基线：`7ab0eb5 docs: record dev tunnel auth diagnostic defect`。

当前已证明且仍参与下一步裁决的事实：

```text
Browser Extension release/workspace/materialization = 0.1.50 / PASS
Chrome actual adoption = PASS
Extension ID = eehdadpmjffomabiedcjijiakconalab
verification.moduleVersion = 0.1.50
verification.extensionInstanceId = extension:b8a13837-6f82-4467-8ab2-e18821478edf
verification.evidenceSource = PAIRING_HEARTBEAT
Browser module status = READY / runtimeStatus=NOT_APPLICABLE

production one-start budget = CONSUMED / FAILED
platform start result = FAILED / firstFailedModule=dev-tunnel
start-owner after failure = ABSENT
production bridge / Observer recovery / same-Execution redecision = NOT_REACHED
Browser log lines = 5041 / unchanged through failed start
Execution log lines = 4295 / unchanged through failed start
```

Chrome 0.1.50 adoption、Reload harness、Extensions page canonicalization、semantic card binding 均已闭环；它们不再是当前 blocker。详细 evidence 只在历史快照按需读取。

## FIXED_REAL3_TRUTH

```text
Task = task-a6f859c00b1accd027d53d48
Task status = ACTIVE
Task version = 10
currentNodeId = dev

Dev role = g-6a9717f68ef081918aacd5911916d2ec
Dev worker = 6a9b4632-ca8c-83e9-a4bc-9de9e229e515
Dev status = IN_PROGRESS
Dev runNo = 1

Test role = g-6a97186190108191bc24fb85b2cff584
Test worker = 6a9b8ae0-f694-83e8-b4a2-0d20cbc5c04a
Test status = PENDING
Test runNo = 1

Product role = g-6a97182669f88191a943e806a3e1b42a
Product worker = 6a9b243c-7af8-83e9-a005-2ccfb8c5c8cb
```

正式 same-run resume 已完成，durable `TASK_RESUMED = task-event:10`；禁止再次 ACK / resume / reopen。

固定原 Execution：

```text
executionRef = execution:e9b9c020-bfe2-4d85-8a17-e3c4a0b7a2c0
idempotencyKey = task-observer-wake:task-a6f859c00b1accd027d53d48:dev:1:TASK_RESUMED:task-event:10
status = FAILED
sideEffectState = NOT_APPLIED
attemptCount = 1
error = PRECONDITION_FAILED / WAKE_TRIGGER_TYPE_INVALID
Execution count = 5
```

下一次真实 runtime 验证仍必须在**同一 Task / Worker / Execution** 上继续；不得创建替代 Execution。

## CURRENT_PROBLEM_CLASS

```text
current_class = REAL3_PRODUCTION_START_BLOCKED_BY_DEV_TUNNEL_AUTH
first_divergence = platform.start -> dev-tunnel runtime start -> login/control-plane access
formal_platform_surface = TUNNEL_RUNTIME_FAILED / Tunnel 运行状态检查失败
remote_read_only_evidence = Login token expired / exit=3
remote_tunnel_existence = UNKNOWN / AUTH_BLOCKED
remote_port_existence = UNKNOWN / AUTH_BLOCKED
observer_fix_0.1.50 = NOT_REACHED_IN_PRODUCTION
```

### Dev Tunnel 当前现场

本地持久状态仍在：

```text
contract = proflow.dev-tunnel-setup.v2
tunnelId = proflow-aeb1e6d087caaf089de01d41
phase = READY
gatewayPort = 41705
publicBaseUrl = https://0br1cj2q-41705.jpe1.devtunnels.ms/
process.json = MISSING
CLI version observed = 1.0.2030
```

`phase=READY` 只证明本地持久配置曾完成，**不证明当前 remote login、Tunnel 或 port 仍存在**。只读远端查询已明确返回 `Login token expired`，因此当前首先要恢复认证；在认证恢复前不得把 remote Tunnel/port 判为 MISSING，更不得创建/删除资源。

## CURRENT_KNOWN_DEFECT

```text
DEFECT = DEV_TUNNEL_DIAGNOSTIC_REASON_COLLAPSE
STATUS = PROVEN / PENDING_PRODUCT_FIX
```

当前实现链：`platform start -> dev-tunnel start() -> observeLogin() -> devtunnel user show --json` 确实会做 login check；问题是：

- `status()` 不验证 remote login reality；
- `observeLogin()` 会把 `Login token expired` 等具体 CLI 原因压成 `UNKNOWN`；
- 上层最终只暴露模糊的 `TUNNEL_RUNTIME_FAILED / Tunnel 运行状态检查失败`。

后续产品修复应保留/传播可执行原因，例如 `AUTH_EXPIRED / NOT_LOGGED_IN / QUERY_TIMEOUT / CLI_ERROR`，并补 regression。该缺陷不得被“重新登录后成功”掩盖。

## CURRENT_TOOL_ROUTE

```text
Problem owner = @tomflow/proflow-dev-tunnel
First authority = Dev Tunnel remote auth reality
Primary Runbook = 03-自动化知识库/包能力/dev-tunnel.md
Execution = Local Dev / canonical package-managed CLI
Browser = 只有真实登录事务需要 GitHub Browser Auth 时才进入 Playwright
```

不要读取 Browser Extension 源码或重跑 Chrome adoption；当前最大不确定性不在 Browser Plane。

## DEV_TUNNEL_DIAGNOSTIC_FIX

```text
SOURCE_FIX = PASS / LOCAL
LOGIN_CLASSIFICATION = AUTH_EXPIRED / NOT_LOGGED_IN / QUERY_TIMEOUT / CLI_ERROR / UNKNOWN
STATUS_PREFLIGHT = AUTH_ACTION_REQUIRED / QUERY_OR_CLI_BLOCKED / LOGGED_IN_READY
START_ERROR_CONTRACT = START_FAILED + CLASSIFIED_MESSAGE
PACKAGE_GATE = PASS / 42_OF_42 + TYPECHECK + BIOME + DIFF_CHECK
REGISTRY_ADOPTION = NOT_RUN
PRODUCT_WORKSPACE_ADOPTION = NOT_RUN
REAL_EXPIRED_TOKEN_STATUS_REPLAY = NOT_RUN
```

当前 token-expired 现场应保留到新包真实采用后，用真实 `platform status` 做 same-scene replay；在此之前不要先登录，否则会销毁最有价值的诊断复验证据。

## NEXT_ACTION

1. Dev Tunnel 诊断缺陷源码与 package gate 已 PASS；**保留当前 expired-token 现场**。
2. 按 `Package-Update-Loop` 只发布/采用 `@tomflow/proflow-dev-tunnel` 新版本；不得顺带改其它 package。
3. Product Workspace 采用后，在不登录、不 start 的前提下只运行真实 `platform status`：必须直接得到 `TUNNEL_AUTH_EXPIRED` + `setupStatus=ACTION_REQUIRED`；若仍泛化为 `TUNNEL_RUNTIME_FAILED`，STOP，说明发布/采用或诊断链仍有问题。
4. Batch 1 same-scene status PASS 后，再执行一次 canonical Dev Tunnel 登录恢复，并只读确认原 tunnel + exact 41705 port 是否仍存在；认证恢复前不得推导 remote resource MISSING。
5. Login/Tunnel/Port reality 全明确后，才冻结 Validation Batch 2 / Real-3 新 production-start acceptance。旧 one-start acceptance 已消费，禁止直接 retry。

## CURRENT_MUTATION_AUTHORITY

```text
DEV_TUNNEL_LOGIN_RECOVERY = NOT_YET_ADMITTED / MUST_FREEZE_BOUNDARY_FIRST
REMOTE_TUNNEL_CREATE_DELETE = FORBIDDEN
REMOTE_PORT_MUTATION = FORBIDDEN_UNTIL_REMOTE_REALITY_PROVEN
PLATFORM_START = NOT_ADMITTED / PREVIOUS_ONE_START_CONSUMED
PLATFORM_STOP = NOT_ADMITTED
BROWSER_EXTENSION_MUTATION = FORBIDDEN
TASK_EXECUTION_MANUAL_MUTATION = FORBIDDEN
PRODUCT_FIX = ALLOWED_ONLY_AFTER_ROOT_CAUSE_SCOPE_FROZEN
PUSH = FORBIDDEN
```

当前上下文治理/只读诊断不构成新的 runtime mutation authority。

## DO_NOT_REPEAT

- 不重新 release/update/reload Browser Extension 0.1.50；Chrome actual adoption 已 PASS。
- 不再执行 Round 2/3/4 的 targeted setup / semantic Reload；旧 acceptance 全部已消费。
- 不因为本地 `dev-tunnel phase=READY` 就推导 remote login/tunnel/port READY。
- 不把 `Login token expired` 误判成 Tunnel 已删除；认证未恢复前 remote existence 是 UNKNOWN。
- 不删除/新建 Tunnel，不改 port，不直接写 `.proflow` 来绕过登录。
- 不第二次 `platform start`，直到新的 acceptance 单独冻结。
- 不人工发 `TASK_OBSERVER_RECOVER` / `task.wake` / Execution retry。
- 不再次 task.resume / ACK / reopen；不创建新 Task / Worker / GPT / Execution。
- 不把 `TUNNEL_RUNTIME_FAILED` 表层信息当成足够精确的内部根因；诊断缺陷已登记，必须处理。
- 不 push。

## REQUIRED_CONTEXT

1. `03-自动化知识库/包能力/dev-tunnel.md`
2. `03-自动化知识库/基础动作/CLI-PTY交互自动化.md`
3. `03-自动化知识库/基础动作/Round-PID-Log与恢复.md`

## ON_DEMAND_CONTEXT

- 真实 GitHub Browser Auth 被打开时：`03-自动化知识库/基础动作/Browser-UI自动化.md`
- Playwright/MCP runtime 自身异常时：`03-自动化知识库/基础动作/Tool-Runtime-gptweb-mcp.md`
- 需要追溯 0.1.50 / Round 2～4 / one-start 原始 evidence 时：`90-历史记录/Real3/27-Real3-J4-0.1.50采用到ProductionStart-DevTunnel失败-CURRENT快照-20260908.md`

## HISTORY_REFERENCES

- `90-历史记录/Real3/24-Real3执行效率与证据链教训-20260907.md`
- `90-历史记录/Real3/25-Real3-0.1.49真实复验失败与当前Chat交接-20260907.md`
- `90-历史记录/Real3/27-Real3-J4-0.1.50采用到ProductionStart-DevTunnel失败-CURRENT快照-20260908.md`

历史只用于追因，不参与当前投票裁决。

## STOP_POINT

`J1_J2_J3_PASS / J4_PAUSED / 0.1.50_RELEASE_WORKSPACE_MATERIALIZATION_PASS / CHROME_ACTUAL_ADOPTION_0.1.50_PASS / BROWSER_MODULE_READY / PRODUCTION_ONE_START_CONSUMED_FAILED_DEV_TUNNEL / START_OWNER_ABSENT / DEV_TUNNEL_LOCAL_PHASE_READY / DEV_TUNNEL_AUTH_EXPIRED_PROVEN / REMOTE_TUNNEL_EXISTENCE_UNKNOWN / REMOTE_PORT_41705_EXISTENCE_UNKNOWN / DEV_TUNNEL_DIAGNOSTIC_REASON_COLLAPSE_PROVEN_PENDING_FIX / SAME_TASK_WORKER_EXECUTION_UNCHANGED / PRODUCTION_BRIDGE_OBSERVER_REDECISION_NOT_REACHED / PLATFORM_START_NOT_ADMITTED / REMOTE_RESOURCE_MUTATION_FORBIDDEN / PUSH_FORBIDDEN`。

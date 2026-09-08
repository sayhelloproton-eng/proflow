# CURRENT｜Phase 3 当前接力

> 更新时间：2026-09-08。这里是下一 Chat 的唯一滚动执行入口。

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
CURRENT_EXECUTION_MODE = REAL3_DEV_TUNNEL_0_1_35_ADOPTION_PENDING
```

## CURRENT_AUTHORITY

当前 Git / Registry / Product Workspace / Browser / runtime reality 必须在执行前机械回读；本文只记录最近已证明 checkpoint，不替代实时 authority。

```text
Browser Extension = 0.1.50 / actual Chrome adoption PASS
Browser module = READY / runtimeStatus=NOT_APPLICABLE
old production one-start acceptance = CONSUMED / FAILED at dev-tunnel
production bridge / Observer recovery / same-Execution redecision = NOT_REACHED

Dev Tunnel diagnostic hardening 0.1.34 = released + Product Workspace adopted + real status schema replay PASS
Dev Tunnel auth root cause = AUTH_EXPIRED / mechanically proven
canonical Browser Auth recovery = mechanically completed / Logged in via GitHub before machine reboot
Dev Tunnel start auto-reauth fix = PASS
Dev Tunnel package gate = 46/46 + typecheck + Biome + diff-check PASS
Dev Tunnel 0.1.35 = Registry publish PASS
Dev Tunnel 0.1.35 Product Workspace adoption = NOT_YET_EXECUTED
```

功能提交：`1ceb0103bad2 fix(dev-tunnel): reauthorize expired login on start`。
版本提交：`c9624537bafd chore(release): version dev-tunnel to 0.1.35`。

## FIXED_REAL3_TRUTH

```text
Task = task-a6f859c00b1accd027d53d48 / ACTIVE / version=10 / currentNodeId=dev
Dev = IN_PROGRESS / runNo=1 / worker=6a9b4632-ca8c-83e9-a4bc-9de9e229e515
Test = PENDING / runNo=1 / worker=6a9b8ae0-f694-83e8-b4a2-0d20cbc5c04a

TASK_RESUMED = task-event:10 / already completed
ACK / resume / reopen again = FORBIDDEN

fixed Execution = execution:e9b9c020-bfe2-4d85-8a17-e3c4a0b7a2c0
status = FAILED / NOT_APPLIED / attemptCount=1
error = PRECONDITION_FAILED / WAKE_TRIGGER_TYPE_INVALID
Execution count = 5
new Task / Worker / Execution = FORBIDDEN
```

## CURRENT_PROBLEM_CLASS

```text
current_class = REAL3_DEV_TUNNEL_ADOPTION_AND_REMOTE_REALITY
code defect = CLOSED at 0.1.35 source/release gate
current maximum uncertainty = Product Workspace adoption + post-reboot auth/tunnel/port reality
remote tunnel = proflow-aeb1e6d087caaf089de01d41 / EXISTENCE TO REVERIFY
exact port = 41705 / http / EXISTENCE+PROTOCOL TO REVERIFY
platform start = NOT_ADMITTED
```

本地持久配置仍指向：

```text
tunnelId = proflow-aeb1e6d087caaf089de01d41
gatewayPort = 41705
publicBaseUrl = https://0br1cj2q-41705.jpe1.devtunnels.ms/
```

机器已重启，因此之前的 `LOGGED_IN` / process reality 不能直接当作重启后实时 authority；下一批必须重新只读回读。

## NEXT_ACTION

执行一个最小 Reality Batch，不逐步拆成多轮 Chat 决策：

```text
1. Product Workspace targeted update @tomflow/proflow-dev-tunnel → 0.1.35
2. exact readback workspace version = 0.1.35
3. package-managed CLI read-only auth reality
4. auth 为 AUTH_EXPIRED / NOT_LOGGED_IN 时，允许既有 Browser Auth 自恢复；UNKNOWN/timeout fail-closed
5. read-only show original tunnel
6. read-only exact 41705 port + protocol
7. local persisted setup/process authority
8. 输出一份 evidence bundle
```

只有 `login + original tunnel + exact 41705/http` 全部明确后，才更新 CURRENT 并冻结 **新的** production-start acceptance。旧 acceptance 永久不可 retry。

## CURRENT_MUTATION_AUTHORITY

```text
PRODUCT_WORKSPACE_TARGETED_UPDATE_0_1_35 = ADMITTED
DEV_TUNNEL_AUTH_RECOVERY_IF_EXPLICITLY_EXPIRED_OR_LOGGED_OUT = ADMITTED
REMOTE_TUNNEL_CREATE_DELETE = FORBIDDEN
REMOTE_PORT_MUTATION = FORBIDDEN_UNTIL_REMOTE_REALITY_PROVEN
PLATFORM_START = NOT_ADMITTED / OLD ACCEPTANCE CONSUMED
PLATFORM_STOP = NOT_ADMITTED
BROWSER_EXTENSION_MUTATION = FORBIDDEN
TASK_EXECUTION_MANUAL_MUTATION = FORBIDDEN
PUSH = FORBIDDEN
```

## DO_NOT_REPEAT

- 不重新研究 Dev Tunnel 登录命令；canonical Browser Auth 已验证。
- 不重新 release 0.1.34/0.1.35；0.1.35 Registry publish 已 PASS。
- 不重新 release/update/reload Browser Extension 0.1.50。
- 不把机器重启前的登录/process 状态冒充当前 realtime authority。
- 不因为 remote query 失败就推导 Tunnel 已删除。
- 不创建/删除 Tunnel，不改 port，直到 read-only reality 明确。
- 不直接第二次 `platform start`；必须先冻结新的 acceptance。
- 不人工发 `TASK_OBSERVER_RECOVER` / `task.wake` / Execution retry。
- 不再次 task.resume / ACK / reopen。
- 不 push。

## REQUIRED_CONTEXT

1. `03-自动化知识库/包能力/dev-tunnel.md`
2. `03-自动化知识库/基础动作/Round-PID-Log与恢复.md`
3. `03-自动化知识库/基础动作/GPT-Chat-MCP-Mac高吞吐执行规则.md`

## ON_DEMAND_CONTEXT

- Browser Auth 真正进入交互：`03-自动化知识库/基础动作/Browser-UI自动化.md`
- MCP runtime 异常：`03-自动化知识库/基础动作/Tool-Runtime-gptweb-mcp.md`
- 追溯旧 one-start / 0.1.50 原始 evidence：`90-历史记录/Real3/`

## STOP_POINT

`J1_J2_J3_PASS / J4_PAUSED / BROWSER_0_1_50_PASS / OLD_PRODUCTION_START_CONSUMED_FAILED_DEV_TUNNEL / DEV_TUNNEL_0_1_34_DIAGNOSTIC_ADOPTION_PASS / AUTH_EXPIRED_ROOT_CAUSE_PROVEN / AUTH_RECOVERY_PATH_PROVEN / START_AUTO_REAUTH_0_1_35_RELEASED / PRODUCT_WORKSPACE_0_1_35_ADOPTION_PENDING / POST_REBOOT_LOGIN_TUNNEL_PORT_REALITY_PENDING / NEW_PRODUCTION_START_NOT_ADMITTED / SAME_TASK_WORKER_EXECUTION_FROZEN / PUSH_FORBIDDEN`。

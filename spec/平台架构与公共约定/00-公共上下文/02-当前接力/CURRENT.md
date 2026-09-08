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
CURRENT_EXECUTION_MODE = REAL3_PRODUCTION_START_ACCEPTANCE_FROZEN
```

## CURRENT_AUTHORITY

当前 Git / Registry / Product Workspace / Browser / runtime reality 必须在执行前机械回读；本文只记录最近已证明 checkpoint，不替代实时 authority。

```text
Browser Extension = 0.1.50 / actual Chrome adoption PASS
Browser module = READY / runtimeStatus=NOT_APPLICABLE
old production one-start acceptance = CONSUMED / FAILED at dev-tunnel / NEVER RETRY
production bridge / Observer recovery / same-Execution redecision = NOT_REACHED

Dev Tunnel start auto-reauth source gate = PASS / 46/46 + typecheck + Biome + diff-check
Dev Tunnel 0.1.35 = BAD REGISTRY ARTIFACT / workspace:^ leaked by source-directory publish
Dev Tunnel 0.1.36 = validated pack artifact + Registry exact/latest PASS
Dev Tunnel 0.1.36 Product Workspace adoption = PASS
managed Dev Tunnel CLI = 1.0.2030 / package-owned / checksum PASS / LOGGED_IN
original Tunnel = proflow-aeb1e6d087caaf089de01d41.jpe1 / EXISTS
exact Gateway port = 41705 / http / EXISTS
Dev Tunnel local setup = READY / process MISSING after reboot
DEV_TUNNEL_REMOTE_REALITY_GATE = PASS

SAME-SCENE pre-start baseline = REVALIDATED
Browser log baseline = 5041
Execution log baseline = 4295
Execution count = 5 / observer signal count = 0
start-owner = ABSENT
47080 / 51443 listeners = ABSENT
Browser verification = 0.1.50 / eehdadpmjffomabiedcjijiakconalab / extension:b8a13837-6f82-4467-8ab2-e18821478edf / PAIRING_HEARTBEAT

model-provider-api = READY / live probe PASS
configured Provider = http://192.168.0.101:8080/v1
provider inventory = 4 models / existing FAST + THINK models present
model-runtime = READY / runtimeStatus=STOPPED
23 Module setupStatus = 23/23 READY
platform start implementation = VERIFIED fail-closed when any Module setupStatus != READY
new production-start acceptance = FROZEN / REAL3_PRODUCTION_START_20260908T093352Z
acceptance scope = exactly one platform start
acceptance baseline = Task/Node/Role identity SAME / fixed Execution SAME / Execution count 5 / Observer 0 / Browser log 5041 / Execution log 4295 / start-owner ABSENT / 47080+51443 ABSENT / Browser 0.1.50 PAIRING_HEARTBEAT
```

功能提交：`1ceb0103bad2 fix(dev-tunnel): reauthorize expired login on start`。
0.1.36 版本提交：`635a2f13f01b chore(release): version dev-tunnel to 0.1.36`。

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
current_class = REAL3_PRODUCTION_START_ADMITTED
product regression = NOT_PROVEN
Dev Tunnel blocker = CLOSED / REMOTE_REALITY_GATE_PASS
model-provider-api = READY / live probe PASS
bound Base URL = http://192.168.0.101:8080/v1
provider IP drift = user-authorized direct runtime-state correction from .108 to .101 / setup intentionally skipped
model-runtime = READY / STOPPED
23 Module setupStatus = 23/23 READY
platform start = ADMITTED exactly once under REAL3_PRODUCTION_START_20260908T093352Z
```

前一 Provider blocker 已关闭：用户明确提供新 IP 并授权跳过 setup，运行态三份 Provider 事实已在真实 `/v1/models` HTTP 200 + FAST/THINK inventory 证明后同步到 `.101`；这次直接状态修正属于一次性显式授权，不改变正常产品路径仍以 Platform owner 为准。

## NEXT_ACTION

```text
1. 提交 REAL3_PRODUCTION_START_20260908T093352Z acceptance
2. 提交后只读确认 Git clean；Product SAME-SCENE baseline 不允许漂移
3. 消费 exactly-one `platform start --workspace /Users/agent/Desktop/proton-workspace`
4. 若 start 调用 timeout / UNKNOWN：先恢复 start-owner、process、listeners、Module status 与日志 authority，禁止盲目重发
5. 收集 post-start evidence bundle：start outcome / start-owner / listeners / Browser+Execution log delta / Task+Execution+Observer
6. 证明 0.1.50 bridge → Observer recovery → 同一 fixed Execution redecision
7. 继续 Dev → Test → Task SUCCEEDED，只有真实 Journey 终态才能裁决 J4/REAL_3 PASS
8. 每个稳定 checkpoint 自动更新 CURRENT；不等待用户提醒沉淀
```

Dev Tunnel 不再重查；除非出现新的矛盾 evidence，不重跑 0.1.36 release/adoption/remote reality。

## CURRENT_MUTATION_AUTHORITY

```text
MODEL_PROVIDER_READ_ONLY_REALITY = ADMITTED
MODEL_PROVIDER_DIRECT_RUNTIME_STATE_EDIT = CONSUMED_BY_EXPLICIT_USER_AUTHORITY / COMPLETE
MODEL_PROVIDER_CANONICAL_SETUP = NOT_REQUIRED_FOR_THIS_IP_DRIFT_RECOVERY
FULL_SUBNET_OR_DEVICE_DISCOVERY = FORBIDDEN
REMOTE_TUNNEL_CREATE_DELETE = FORBIDDEN
REMOTE_PORT_MUTATION = FORBIDDEN
PLATFORM_START = ADMITTED_ONCE / REAL3_PRODUCTION_START_20260908T093352Z
PLATFORM_START_RETRY_IF_TIMEOUT_UNKNOWN = FORBIDDEN_UNTIL_AUTHORITY_RECOVERY
PLATFORM_STOP = NOT_ADMITTED
BROWSER_EXTENSION_MUTATION = FORBIDDEN
TASK_EXECUTION_MANUAL_MUTATION = FORBIDDEN
PUSH = FORBIDDEN
```

## DO_NOT_REPEAT

- 不重新研究 Dev Tunnel 登录/Tunnel/41705；0.1.36 managed CLI + remote reality 已 PASS。
- 不重新 publish 0.1.35；它是坏 artifact。0.1.36 validated tarball + Registry/adoption 已 PASS。
- 不重新 release/update/reload Browser Extension 0.1.50。
- 不重新扫描 Dev Tunnel remote reality，除非出现矛盾 evidence。
- 不把旧 Provider observation 当 live READY。
- 不扫描整个 LAN、不引入 Bonjour/mDNS/iPhone identity；Model Provider 只认 URL + inventory。
- 只允许消费 `REAL3_PRODUCTION_START_20260908T093352Z` 这一笔 start；一旦调用即视为 consumed，timeout/UNKNOWN 先恢复 authority，禁止盲目重发。
- 不人工发 `TASK_OBSERVER_RECOVER` / `task.wake` / Execution retry。
- 不再次 task.resume / ACK / reopen。
- 不 push。

## REQUIRED_CONTEXT

1. `03-自动化知识库/包能力/model-provider-runtime.md`
2. `03-自动化知识库/包能力/dev-tunnel.md`
3. `03-自动化知识库/基础动作/Round-PID-Log与恢复.md`
4. `03-自动化知识库/基础动作/GPT-Chat-MCP-Mac高吞吐执行规则.md`

## ON_DEMAND_CONTEXT

- Browser Auth 真正进入交互：`03-自动化知识库/基础动作/Browser-UI自动化.md`
- MCP runtime 异常：`03-自动化知识库/基础动作/Tool-Runtime-gptweb-mcp.md`
- 追溯旧 one-start / 0.1.50 原始 evidence：`90-历史记录/Real3/`

## STOP_POINT

`J1_J2_J3_PASS / J4_PAUSED / BROWSER_0_1_50_PASS / DEV_TUNNEL_0_1_36_ADOPTED / DEV_TUNNEL_REMOTE_REALITY_PASS / MODEL_PROVIDER_192_168_0_101_READY / 23_OF_23_SETUP_READY / SAME_SCENE_PRESTART_BASELINE_FROZEN / REAL3_PRODUCTION_START_20260908T093352Z_ADMITTED_ONCE / SAME_TASK_WORKER_EXECUTION_FROZEN / PUSH_FORBIDDEN`。

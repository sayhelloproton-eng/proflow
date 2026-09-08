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
CURRENT_EXECUTION_MODE = REAL3_BROWSER_CARRIER_COMPOSER_HARDENING
```

## CURRENT_AUTHORITY

当前 Git / Registry / Product Workspace / Browser / runtime reality 必须在执行前机械回读；本文只记录最近已证明 checkpoint，不替代实时 authority。

```text
Browser Extension = 0.1.50 / actual Chrome adoption PASS
Browser module = READY / runtimeStatus=NOT_APPLICABLE
old production one-start acceptance = CONSUMED / FAILED at dev-tunnel / NEVER RETRY
production bridge / Observer recovery / same-Execution redecision = PASS

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
production-start acceptance = REAL3_PRODUCTION_START_20260908T093352Z / CONSUMED ONCE / PASS
platform start = exit 0 / success 5 / skipped 18 / failed 0
post-start listeners = 41705 + 47080 + 51443 LISTENING
Browser reboot wake gap = extension registration intact but MV3 session initially OFFLINE until extension context wake
Browser session revalidation = PASS / instance extension:3df1cf12-b17b-4cc0-aac4-b804b6a0d965 / 0.1.50 / READY
Observer recovery 0.1.50 = PASS / BRIDGE_EPOCH_ACCEPTED + REARM_CALLBACK_ENTERED + REUSED_IN_FLIGHT
fixed Execution redecision = PASS / SAME executionRef + SAME idempotencyKey + SAME inputFingerprint / attemptCount 1 -> 2
fixed Execution second attempt = FAILED / NOT_APPLIED / EXECUTION_FAILED / COMPOSER_NOT_FOUND
Execution count = 5 / observer signal count = 0 / no new Execution
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
status = FAILED / NOT_APPLIED / attemptCount=2
latest error = EXECUTION_FAILED / COMPOSER_NOT_FOUND
latest redecision startedAt = 2026-09-08T09:44:49.811Z / finishedAt = 2026-09-08T09:45:13.857Z
historical attempt 1 error = PRECONDITION_FAILED / WAKE_TRIGGER_TYPE_INVALID
Execution count = 5
new Task / Worker / Execution = FORBIDDEN
```

## CURRENT_PROBLEM_CLASS

```text
current_class = BROWSER_CARRIER_SUBMIT_COMPOSER_NOT_FOUND
product regression = UNDER_INVESTIGATION / real production evidence exists
Dev Tunnel blocker = CLOSED / REMOTE_REALITY_GATE_PASS
Model Provider blocker = CLOSED / 192.168.0.101 READY
production start = CONSUMED / PASS
Browser live session = READY after narrow owner revalidation
bridge -> Observer recovery -> same fixed Execution redecision = PASS
carrier LIST_TABS / OPEN / OBSERVE = PASS
carrier SUBMIT = FAILED / COMPOSER_NOT_FOUND
carrier VERIFY = PASS
task.wake = FAILED / TASK_WAKE_NOT_CONFIRMED:FAILED:NOT_APPLIED
current first divergence = ChatGPT carrier composer discovery during SUBMIT
```

前一 Provider blocker 已关闭：用户明确提供新 IP 并授权跳过 setup，运行态三份 Provider 事实已在真实 `/v1/models` HTTP 200 + FAST/THINK inventory 证明后同步到 `.101`；这次直接状态修正属于一次性显式授权，不改变正常产品路径仍以 Platform owner 为准。

## NEXT_ACTION

```text
1. CodeGraph 锁定 content-script composer discovery / SUBMIT owner 与 blast radius
2. Playwright Chrome 读取真实 Dev conversation 当前 DOM / editor surface，不用旧 selector 猜
3. 若确认 ChatGPT DOM 漂移：最小兼容修复 + targeted content/browser carrier tests
4. 统一 extension full gate / typecheck / governance / diff-check
5. 若需发布 Browser 新版本：validated artifact -> Registry -> Product Workspace adoption -> current Chrome adoption
6. 禁止手工 retry fixed Execution；只通过正常 Browser session / Observer recovery 触发 SAME Execution redecision
7. Dev 成功后继续 Test -> Task SUCCEEDED -> J4 PASS -> REAL_3 PASS
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
PLATFORM_START = CONSUMED / REAL3_PRODUCTION_START_20260908T093352Z / PASS
PLATFORM_START_RETRY = FORBIDDEN
BROWSER_SESSION_EVIDENCE_REVALIDATION = COMPLETE / READY
BROWSER_CARRIER_SOURCE_REPAIR_IF_ROOT_PROVEN = ADMITTED
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

`J1_J2_J3_PASS / J4_PAUSED / PRODUCTION_START_PASS_CONSUMED / BROWSER_0_1_50_RECOVERY_PASS / SAME_FIXED_EXECUTION_REDECISION_PASS_ATTEMPT2 / CURRENT_BLOCKER_COMPOSER_NOT_FOUND / EXECUTION_COUNT_5 / SAME_TASK_WORKER_EXECUTION_FROZEN / PUSH_FORBIDDEN`。

## REAL3_RESTART_ACCEPTANCE_20260908T111318Z

- PLATFORM_HOST_INSTALLED: .
- PRESTART_RUNTIME: ; .
- PROVIDER:  reachable.
- SAME_SCENE: Task=; Dev=; Test=; Execution total=; fixed wake=.
- ADMISSION: exactly one 平台未启动：配置尚未完成

◆ 浏览器扩展
原因：Chrome 扩展尚未加载或缺少可验证的运行证据

PLATFORM_READY=NO
处理方式：platform setup --workspace "/Users/agent/Desktop/proton-workspace/repos/proflow" for 0.1.20 adoption; no Task/Worker/Execution creation and no manual wake/retry.

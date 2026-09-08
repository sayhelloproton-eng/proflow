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
CURRENT_EXECUTION_MODE = REAL3_PLATFORM_HOST_0_1_21_WAITING_FOR_MODEL_RESTART
```

## CURRENT_AUTHORITY

当前 Git / Registry / Product Workspace / Browser / runtime reality 必须在执行前机械回读；本文只记录最近已证明 checkpoint，不替代实时 authority。

```text
Browser Extension = 0.1.50 / actual Chrome adoption PASS
Browser recovery + trailing rearm + SAME fixed wake redecision = PASS
COMPOSER_NOT_FOUND = TRANSIENT / AUTO-RECOVERED / NOT_CURRENT_BLOCKER
fixed historical wake = SUCCEEDED / APPLIED / attemptCount=3

Dev Tunnel 0.1.36 = Registry/adoption/remote reality PASS
managed Dev Tunnel CLI = 1.0.2030 / package-owned / LOGGED_IN
Tunnel = proflow-aeb1e6d087caaf089de01d41.jpe1 / 41705 http / current listener PRESENT

Provider configured URL = http://192.168.0.101:8080/v1
Provider was previously READY and inventory-verified after DHCP drift .108 -> .101
2026-09-08 current external reality = USER IS USING PHONE FOR GAME / PROVIDER UNAVAILABLE
formal platform status = Browser PASS + Tunnel PASS + Model FAIL / PLATFORM_READY=NO
MODEL_UNAVAILABLE is external environment, not a newly proven Product regression

Platform Host 0.1.20 Product adoption = PASS / current running runtime version
Platform Host 0.1.21 source fix = PASS
0.1.21 functional commit = 2090e1e5ddf8 fix(platform-host): expose exact execution request context
0.1.21 version commit = d7ebf9445b5e chore(release): version platform-host to 0.1.21
0.1.21 targeted B1 regression = PASS
0.1.21 full platform-host gate = 58/58 PASS + typecheck + Biome + diff-check
0.1.21 publishability = PASS / workspace:^ leak NONE
0.1.21 Registry exact = PASS
0.1.21 Registry artifact = VERIFIED contains executionRequestContext + executionCapabilityIds
Product Workspace installed platform-host = 0.1.20 / NOT_YET_ADOPTED_0_1_21
current platform listeners = 41705 + 47080 + 51443 LISTENING
PLATFORM_STOP_FOR_0_1_21 = NOT_ADMITTED while Provider unavailable

Root cause = SAME Dev Worker uses an old Custom GPT Conversation snapshot whose executeCapability schema permits taskId/nodeId/runNo omission; current exact-node Platform Host admission requires all three and fails before durable file.read Execution creation.
0.1.20 exposed exact capability IDs and proved old Worker can select file.read, but did not expose a canonical Execution request envelope.
0.1.21 keeps exact-node fencing unchanged and extends getNodeContext projection with executionRequestContext={contract,contractVersion,taskId,nodeId,runNo}; old Worker can copy Owner facts without guessing and Host still rejects missing/stale/wrong-role scope.
```

## OFFLINE_VERIFICATION_20260908

```text
Registry exact @tomflow/proflow-platform-host@0.1.21 = PASS
Registry dist-tag latest = 0.1.21
release-sync platform-host = PASS
Registry isolated install/import = PASS
Registry dist/src/index.js SHA = LOCAL GATED DIST MATCH
Registry deployment/adapter.js SHA = LOCAL GATED DIST MATCH
Registry deployment/descriptor.js SHA = LOCAL GATED DIST MATCH
Registry proflow.module.json SHA = LOCAL GATED DIST MATCH
Registry package.json semantic identity = name/version/exports/bin MATCH
Registry package.json dependency rewrite = EXPECTED workspace:^ -> published semver ranges
Registry manifest workspace: leak = NONE
Registry downloaded tarball SHA1 = npm dist.shasum MATCH

Product installed platform-host = 0.1.20
Product runtime listeners = 41705/47080/51443 LISTENING
Task = WAITING v13 / currentNode=dev
Dev = WAITING v8 / runNo=1 / SAME Worker
Test = PENDING / runNo=1
event:14 blocker = PENDING / EXECUTION_FILE_READ_INVALID_REQUEST
Execution DB = .proflow/runtime/modules/execution-runtime/execution.sqlite
Execution count = 6
Task Execution count = 6
file.read durable Execution count = 0
No background drift observed while Provider unavailable

Offline conclusion = ALL NON-MODEL VERIFICATION COMPLETE
Remaining real-scene dependency = Provider READY for stop -> adopt 0.1.21 -> restart -> ACK/resume -> file.read -> Dev/Test
```

## FIXED_REAL3_TRUTH

```text
Task = task-a6f859c00b1accd027d53d48 / WAITING / version=13 / currentNodeId=dev
Dev = WAITING / version=8 / runNo=1 / SAME worker=6a9b4632-ca8c-83e9-a4bc-9de9e229e515
Test = PENDING / version=1 / runNo=1

latest Task event = event:14 / NODE_WAITING
latest pending blocker = message-fe3473cc-6822-42f9-b3cf-7e300c8a780c
reason = EXECUTION_FILE_READ_INVALID_REQUEST
message truth = Worker now sees frozen capability IDs and selects exact file.read, but old Conversation lacks a complete canonical Execution request context and Host returns INVALID_REQUEST before durable file.read creation.

previous blocker message-874c9508-9961-4ee3-aeea-b7caca48966a = ACKNOWLEDGED
TASK_RESUMED event:13 = COMPLETED
new observer-generated wake execution = execution:139a78ae-f3d3-43a6-965b-2989c62e3143 / SUCCEEDED / APPLIED / attemptCount=1
historical fixed wake = execution:e9b9c020-bfe2-4d85-8a17-e3c4a0b7a2c0 / SUCCEEDED / APPLIED / attemptCount=3
Execution count = 6
no file.read Execution has yet been durably created for event:14
SAME Task / SAME Dev Worker / runNo=1 remains authoritative
```

## CURRENT_PROBLEM_CLASS

```text
current_class = LEGACY_CUSTOM_GPT_ACTION_SCHEMA_VS_EXACT_EXECUTION_CONTEXT
product regression = ROOT_CAUSE_PROVEN / FIX_0_1_21_RELEASED / REAL_SCENE_NOT_YET_VERIFIED
Browser blocker = CLOSED
Dev Tunnel blocker = CLOSED
Provider current blocker = EXTERNAL_ENVIRONMENT / PHONE_MODEL_TEMPORARILY_UNAVAILABLE
platform current runtime = RUNNING on platform-host 0.1.20
platform 0.1.21 adoption = WAITING_FOR_PROVIDER_READY
current first divergence after 0.1.20 = old Worker executeCapability request is rejected before durable file.read Execution creation
```

## NEXT_ACTION

```text
1. While phone model is unavailable: DO NOT stop the currently running platform; keep 0.1.20 runtime/listeners intact.
2. When user restores phone model service, perform ONE live Provider/status probe; require model-provider-api setupStatus READY and 23/23 setupStatus READY.
3. Freeze one adoption/restart bundle: Product platform-host=0.1.20, Task WAITING v13, Dev WAITING v8/runNo1, Test PENDING, Execution count=6, event:14 blocker still pending, listeners/owner facts.
4. One transaction: platform stop -> targeted platform-host update to 0.1.21 -> exact installed-version readback -> new restart acceptance -> exactly one platform start.
5. Verify platform-host runtime 0.1.21 and getNodeContext exposes executionCapabilityIds + canonical executionRequestContext.
6. Through formal Task owner chain: acknowledge event:14 blocker -> resume SAME Task/SAME Dev Worker; no manual worker.wake and no Execution retry.
7. Observer must generate normal wake; require a durable file.read Execution and verified repos/proflow/package.json name/version result.
8. Continue SAME journey Dev SUCCEEDED -> Test independent verification -> Task SUCCEEDED -> J4 PASS -> REAL_3 PASS.
9. After real-scene PASS, update owning Runbook + CURRENT with root cause, contract compatibility pattern, and high-throughput transaction rules; commit, no push.
```

## CURRENT_MUTATION_AUTHORITY

```text
MODEL_PROVIDER_READ_ONLY_REALITY = ADMITTED
MODEL_PROVIDER_DIRECT_RUNTIME_STATE_EDIT = PREVIOUSLY_CONSUMED_FOR_EXPLICIT_IP_DRIFT / NO_NEW_EDIT
FULL_SUBNET_OR_DEVICE_DISCOVERY = FORBIDDEN
REMOTE_TUNNEL_CREATE_DELETE = FORBIDDEN
REMOTE_PORT_MUTATION = FORBIDDEN
PLATFORM_CURRENT_RUNTIME = KEEP_RUNNING_WHILE_PROVIDER_UNAVAILABLE
PLATFORM_STOP_FOR_0_1_21 = NOT_ADMITTED_UNTIL_PROVIDER_READY
PLATFORM_HOST_0_1_21_TARGETED_UPDATE = ADMITTED_ONLY_AFTER_FORMAL_STOP_AND_PROVIDER_READY_PRECHECK
PLATFORM_RESTART_FOR_0_1_21 = NOT_YET_FROZEN / NOT_YET_ADMITTED
BROWSER_EXTENSION_MUTATION = FORBIDDEN
TASK_EVENT14_ACK_RESUME = ADMITTED_ONLY_AFTER_0_1_21_RUNTIME_VERIFIED
TASK_EXECUTION_MANUAL_WAKE_OR_RETRY = FORBIDDEN
NEW_TASK_WORKER = FORBIDDEN
PUSH = FORBIDDEN
```

## DO_NOT_REPEAT

- 不重新研究 Browser `COMPOSER_NOT_FOUND`；它已由 0.1.50 trailing recovery 自动恢复，不是当前 blocker。
- 不重新研究 Dev Tunnel 登录/Tunnel/41705；0.1.36 remote reality 已 PASS。
- 不重新扫描 LAN / Bonjour / mDNS；手机模型当前不可用是用户明确的外部现场。
- 不重复 publish platform-host 0.1.21；Registry exact 与 Registry artifact 已 PASS。
- 不在模型不可用时 stop 当前平台，否则正式 start 会因 Provider preflight fail-closed 而无法恢复。
- 不放宽 exact-node Execution admission，不由 Host 猜 taskId/nodeId/runNo；0.1.21 只公开 canonical request context。
- 不人工发 task.wake，不手工创建/retry file.read Execution；恢复必须从 Task owner ACK + resume 进入 Observer 正常链。
- 不新建 Task / Dev Worker / Conversation 来逃避 legacy snapshot 问题。
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

`J1_J2_J3_PASS / J4_PAUSED / PLATFORM_RUNNING_ON_HOST_0_1_20 / HOST_0_1_21_RELEASED_AND_REGISTRY_VERIFIED / PHONE_MODEL_EXTERNAL_UNAVAILABLE / DO_NOT_STOP / TASK_WAITING_V13_EVENT14 / EXECUTION_COUNT_6 / PUSH_FORBIDDEN`。

## REAL3_PLATFORM_HOST_0_1_21_CHECKPOINT_20260908

- Root cause: old Custom GPT Conversation Action schema permits omission of `taskId/nodeId/runNo`, while current exact-node Host admission requires them before Execution creation.
- Safe fix: `getNodeContext` projects `executionRequestContext={contract,contractVersion,taskId,nodeId,runNo}`; exact-node admission remains fail-closed.
- Source/Gate: `2090e1e5ddf8`; B1 targeted PASS; platform-host 58/58 PASS; typecheck/Biome/diff-check PASS.
- Release: `d7ebf9445b5e`; `@tomflow/proflow-platform-host@0.1.21`; publishability PASS; Registry exact/artifact PASS; no `workspace:` leak.
- Product: still `0.1.20`, runtime/listeners preserved because phone model is intentionally unavailable while user is gaming.
- Restart acceptance: NOT_FROZEN / NOT_ADMITTED until Provider returns READY.

## REAL3_RESTART_ACCEPTANCE_20260908T111318Z｜HISTORICAL_CONSUMED

- RESULT: `CONSUMED / PASS`; this acceptance must never be reused.
- PLATFORM_HOST_INSTALLED: `0.1.20`.
- PRESTART_RUNTIME: `start-owner=ABSENT`; `47080/51443/41705=ABSENT`.
- PROVIDER: `http://192.168.0.101:8080/v1/models` was reachable before that restart.
- SAME_SCENE_AT_ACCEPTANCE: Task=`WAITING v11`; Dev=`WAITING v6/runNo1`; Test=`PENDING v1/runNo1`; Execution total=`5`; fixed wake=`SUCCEEDED/APPLIED/attempt3`.
- OUTCOME: the one admitted `platform start` for 0.1.20 adoption completed; current authority is the 0.1.21 checkpoint above.

## REAL3_PLATFORM_HOST_0_1_21_ADOPTION_FREEZE_20260908T2100

- Provider live probe: HTTP 200, 4 models, existing FAST/THINK inventory present.
- Formal platform status: 23/23 setup READY, PLATFORM_READY=YES.
- Product platform-host=0.1.20; Registry exact/latest platform-host=0.1.21.
- SAME scene: Task WAITING v13; Dev WAITING v8/runNo1/SAME worker; Test PENDING; event:14 blocker PENDING.
- Execution total=6; Task executions=6; durable file.read count=0.
- Runtime before adoption: 41705/47080/51443 LISTENING.
- Adoption authority: exactly one formal platform stop, then targeted platform-host update to 0.1.21; no Task/Worker/Execution mutation.
- Restart authority is NOT yet admitted here; it will be frozen only after installed=0.1.21 and stopped-runtime readback.

## REAL3_PLATFORM_HOST_0_1_21_RESTART_ACCEPTANCE_20260908T2130

- Provider live probe HTTP 200; FAST/THINK inventory present.
- Structured Platform owner status: all 23 Modules setupStatus=READY.
- dev-tunnel runtimeStatus=FAILED is expected while stopped; setupStatus remains READY and does not block start preflight.
- Installed platform-host=0.1.21 / setupStatus=READY / runtimeStatus=STOPPED.
- Runtime prestart: 41705/47080/51443 ABSENT.
- SAME scene remains Task WAITING v13; Dev WAITING v8/runNo1/SAME worker; Test PENDING; event:14 blocker PENDING; Execution total=6; file.read count=0.
- Admission: exactly one platform start for 0.1.21 adoption. Timeout/UNKNOWN requires authority recovery; no blind resend.

# CURRENT｜Phase 3 当前接力

> 更新时间：2026-09-08 23:25 +08。这里是下一 Chat 的唯一滚动执行入口；历史 acceptance 与旧假设不拥有当前 authority。

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
CURRENT_EXECUTION_MODE = REAL3_TYPED_EXECUTION_INPUT_CONTRACT_RELEASED_WAITING_ARTIFACT_CLASSIFICATION
```

## CURRENT_AUTHORITY

```text
repo = /Users/agent/Desktop/proton-workspace/repos/proflow
branch = main
HEAD = 7bcc1ab37fc49b4a01ed7a08a8728e63f1eadfd3
working tree = CLEAN at handoff freeze
Product Workspace = /Users/agent/Desktop/proton-workspace

Provider = http://192.168.0.101:8080/v1
Provider live probe = HTTP 200
runtime listeners = 41705 / 47080 / 51443 LISTENING
platform runtime = RUNNING
```
## RELEASE_AND_PRODUCT_REALITY

```text
correct functional commit = 94cec4fe05d3 fix(execution): expose typed capability input contracts
version commit = 7bcc1ab37fc4 chore(release): version execution contracts and platform host

Registry:
  @tomflow/proflow-execution-contracts@0.1.11 = PRESENT
  @tomflow/proflow-platform-host@0.1.22 = PRESENT

Product installed:
  @tomflow/proflow-execution-contracts = 0.1.10
  @tomflow/proflow-platform-host = 0.1.21
  installed platform-host depends on execution-contracts ^0.1.10

Therefore: correct pair 0.1.11 / 0.1.22 is RELEASED but NOT_ADOPTED.
```

## FIXED_REAL3_TRUTH

```text
Task = task-a6f859c00b1accd027d53d48 / WAITING / version=15 / currentNodeId=dev
Dev = WAITING / version=10 / runNo=1 / SAME worker=6a9b4632-ca8c-83e9-a4bc-9de9e229e515
Test = PENDING / version=1 / runNo=1
latest Task event = event:17 / NODE_WAITING
latest pending blocker = message-bd7135c3-d472-4a23-8b9c-dc010c0c7789
reason = EXECUTION_FILE_READ_INVALID_REQUEST
Task-related Execution count = 7
durable file.read Execution count = 0
SAME Task / SAME Dev Worker / runNo=1 remains authoritative
```
## ROOT_CAUSE_AND_CORRECT_FIX

```text
REAL request body was captured from the SAME Dev ChatGPT Conversation network response.
It contained contract/contractVersion/idempotencyKey/correlationId/taskId/nodeId/runNo/capability=file.read.
It DID NOT contain input.

Therefore the previous 0.1.21 hypothesis "missing taskId/nodeId/runNo" is disproven.
True failure: old agent-controller-dev 0.1.16 Conversation snapshot exposes generic executeCapability input and does not teach the Worker that file.read requires input.path. Worker deliberately did not invent undisclosed parameters, so input was omitted; Host/Execution rejected INVALID_REQUEST before durable Execution creation.

Correct fix:
  execution-contracts exports executionCapabilityInputJsonSchemas generated directly from canonical Zod capabilityInputSchemas via z.toJSONSchema().
  platform-host getNodeContext projects executionCapabilityInputSchemas together with executionCapabilityIds + executionRequestContext.
  file.read projection requires path:string; encoding=utf8 is optional; additionalProperties=false.
  exact-node Execution admission remains fail-closed and unchanged.
```

## CODE_GATE

```text
execution-contracts tests = 9/9 PASS
execution-contracts typecheck = PASS
B1-HOST-EXEC-01 targeted = PASS
platform-host full tests = 58/58 PASS
platform-host typecheck against current source execution-contracts = PASS
Biome = PASS
git diff --check = PASS
canonical targeted build execution-contracts + platform-host = PASS
release-sync = PASS
schema projection = 37 capabilities / ~14 KB serialized
```
## CURRENT_ARTIFACT_GATE

```text
Registry exact 0.1.11 / 0.1.22 = PRESENT.
Product has not adopted them.

Latest handoff-time command:
  node scripts/publishability.mjs execution-contracts platform-host
Result = FAIL after ~147s at final binary smoke:
  Error: published binary smoke failed: proflow-platform-host

Known evidence:
  tarball packing reached completion;
  isolated npm install reached completion;
  failure occurred when smoke runner invoked installed proflow-platform-host --help.
  source CLI and local built dist/src/cli.js both explicitly support --help with exit 0.

Classification = UNKNOWN.
Next Chat MUST reproduce the packed installed binary with captured exit/stdout/stderr and decide REAL_ARTIFACT_BUG vs PUBLISHABILITY_HARNESS_FALSE_NEGATIVE before Product adoption.
Do not call publishability PASS and do not republish blindly.
```

## CURRENT_PROBLEM_CLASS

```text
current_class = LEGACY_CUSTOM_GPT_TYPED_EXECUTION_INPUT_DISCOVERY
root cause = PROVEN_FROM_REAL_WIRE_PAYLOAD
correct source fix = COMMITTED_AND_RELEASED
Product adoption = NOT_DONE
artifact smoke = FAIL / CLASSIFICATION_PENDING
Browser blocker = CLOSED
Dev Tunnel blocker = CLOSED
Provider blocker = CLOSED / LIVE_HTTP_200
REAL_3 = NOT_PASS
```
## NEXT_ACTION

```text
1. Read this CURRENT and mechanically re-read Git/Product/Registry/Task authority; do not trust older event14/0.1.20 handoffs.
2. First classify the 0.1.11+0.1.22 publishability failure by reproducing the packed installed proflow-platform-host --help with captured status/stdout/stderr.
3. If artifact is healthy, freeze SAME-SCENE before mutation: Task WAITING v15, Dev WAITING v10/runNo1/SAME worker, Test PENDING, event17 blocker pending, Task Execution count=7, durable file.read=0, Product installed 0.1.10/0.1.21, provider READY, listeners present.
4. Formal platform stop; targeted adopt BOTH execution-contracts 0.1.11 and platform-host 0.1.22; exact installed-version readback.
5. Require Provider + all Module setupStatus READY; freeze a new restart acceptance; consume exactly one platform start with durable job/result authority.
6. Verify running getNodeContext exposes executionCapabilityInputSchemas["file.read"].required=["path"].
7. Through formal Task owner only: ACK event17 pending blocker -> resume SAME Task; no manual wake/retry/new Execution.
8. Observer must wake SAME Dev. Acceptance requires the REAL Action request to carry capability=file.read and input={path:"repos/proflow/package.json"}.
9. Require a durable file.read Execution with verified package name/version, then Dev SUCCEEDED -> Test independent verification -> Task SUCCEEDED.
10. Only after that: J4 PASS -> REAL_3 PASS; update owning Runbook + CURRENT + final history, commit, no push.
```

## MUTATION_AUTHORITY

```text
PUBLISH_OR_REPUBLISH = FORBIDDEN until artifact authority proves need; target versions already exist in Registry.
PLATFORM_STOP_UPDATE_RESTART = NOT_ADMITTED until artifact smoke classified and fresh SAME-SCENE freeze written.
TASK_EVENT17_ACK_RESUME = NOT_ADMITTED until 0.1.11/0.1.22 runtime adoption verified.
MANUAL_WORKER_WAKE = FORBIDDEN
MANUAL_FILE_READ_EXECUTION_CREATE_OR_RETRY = FORBIDDEN
NEW_TASK_WORKER_CONVERSATION = FORBIDDEN
DIRECT_SQLITE_MUTATION = FORBIDDEN
BROWSER_EXTENSION_MUTATION = FORBIDDEN
REMOTE_TUNNEL_CREATE_DELETE_PORT_MUTATION = FORBIDDEN
PUSH = FORBIDDEN
```
## DO_NOT_REPEAT

- 不再把 `INVALID_REQUEST` 直接解释成缺 `taskId/nodeId/runNo`；真实 wire 已证明这些字段存在，缺的是整个 `input`。
- 不重做 platform-host 0.1.20/0.1.21 的旧假设修复；它们只分别证明 capability discovery / request context projection，不是最终根因。
- 不重新研究 Browser `COMPOSER_NOT_FOUND`；0.1.50 trailing recovery 已真实通过。
- 不重新研究 Dev Tunnel 登录/Tunnel/41705；0.1.36 remote reality 已 PASS。
- 不重新扫描 LAN / Bonjour / mDNS；Provider 当前 `.101` 已 HTTP 200。
- 不手工构造 `file.read` 来绕过 old Worker；必须证明真实 SAME Worker Action payload 自己携带 typed input。
- 不因为 MCP/CLI 超时盲目重发 non-idempotent start/stop/update/publish；先恢复 PID/result/Registry/owner authority。
- 不猜 SQLite 表/列/日志路径；从 owner/runbook/schema 取 canonical path。
- 不 push。

## THROUGHPUT_RULE_FOR_NEXT_CHAT

```text
This Chat's main execution defect: high-probability hypotheses were released before true request-body evidence was captured.
Correct pattern for this class:
  INVALID_REQUEST + no durable Execution
  -> capture real external Action payload first
  -> diff against canonical contract
  -> patch only the proven field gap
  -> targeted gate
  -> artifact gate
  -> one adoption transaction
  -> real-scene replay
Do not widen back to Browser/Tunnel/Model once the boundary is frozen.
Use batch reality snapshots and durable job/result wrappers; minimize fragmented polling.
```

## REQUIRED_CONTEXT

1. `03-自动化知识库/包能力/model-provider-runtime.md`
2. `03-自动化知识库/包能力/dev-tunnel.md`
3. `03-自动化知识库/基础动作/Round-PID-Log与恢复.md`
4. `03-自动化知识库/基础动作/GPT-Chat-MCP-Mac高吞吐执行规则.md`
5. `90-历史记录/Real3/28-Real3-typed-execution-input-contract-当前Chat交接-20260908.md`
6. `90-历史记录/Real3/29-下一个Chat提示词-Real3-typed-execution-input-contract-20260908.md`

## STOP_POINT

`J1_J2_J3_PASS / J4_PAUSED / PLATFORM_RUNNING_PRODUCT_HOST_0.1.21_WITH_EXECUTION_CONTRACTS_0.1.10 / CORRECT_RELEASE_PAIR_0.1.11+0.1.22_PRESENT / ARTIFACT_BINARY_SMOKE_FAIL_CLASSIFICATION_PENDING / TASK_WAITING_V15 / DEV_WAITING_V10_RUN1 / EVENT17_PENDING / EXECUTION_COUNT_7 / FILE_READ_0 / PROVIDER_HTTP_200 / PUSH_FORBIDDEN`。

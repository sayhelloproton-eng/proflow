# 28｜Real-3 typed Execution input contract｜当前 Chat 交接｜2026-09-08

## 1. 交接结论

本 Chat 没有完成 REAL_3；J4 仍是 `PAUSED_FOR_INTEGRATION_HARDENING`。

但当前 `EXECUTION_FILE_READ_INVALID_REQUEST` 已从多层猜测收敛到**真实 wire payload 的字段级根因**，正确修复也已经完成代码 Gate、版本同步并发布到 Registry。

下一 Chat 不应该重新排查 Browser / Tunnel / Provider / scope 字段，而应先处理一个交接前发现的 artifact binary smoke failure，然后采用正确发布对并做 SAME-SCENE 真实回归。

## 2. 当前现场

```text
HEAD = 7bcc1ab37fc49b4a01ed7a08a8728e63f1eadfd3
working tree = clean at handoff freeze
Provider .101 /v1/models = HTTP 200
41705 / 47080 / 51443 = LISTENING
platform = RUNNING

Product installed:
  execution-contracts = 0.1.10
  platform-host = 0.1.21
Registry released:
  execution-contracts = 0.1.11
  platform-host = 0.1.22
```

## 3. SAME-SCENE

```text
Task = task-a6f859c00b1accd027d53d48
Task = WAITING v15 / currentNodeId=dev
Dev = WAITING v10 / runNo=1
Dev worker = 6a9b4632-ca8c-83e9-a4bc-9de9e229e515
Test = PENDING v1 / runNo=1
latest event = event:17 NODE_WAITING
latest pending blocker = message-bd7135c3-d472-4a23-8b9c-dc010c0c7789
Task-related Execution count = 7
durable file.read count = 0
```
## 4. 本 Chat 关键推进

1. 手机 Provider DHCP IP 从 `.108` 漂到 `.101`。按用户明确授权，没有走 setup，直接同步运行态 Provider 事实；新 `/v1/models` HTTP 200，Provider/Model 恢复 READY。
2. production start 与 Browser 0.1.50 真实链通过：bridge / Observer recovery / trailing rearm / SAME historical wake redecision 已证明 PASS。
3. `COMPOSER_NOT_FOUND` 后续自动自愈，不是最终 blocker。
4. Dev Worker 随后多次在 `executeCapability(file.read)` 前端 admission 处 `INVALID_REQUEST`，没有 durable `file.read` Execution。
5. 0.1.20 曾只投影 canonical `executionCapabilityIds`；老 Worker 因此能选择 `file.read`，但仍失败。
6. 0.1.21 曾再投影 `executionRequestContext={contract,contractVersion,taskId,nodeId,runNo}`；真实场景仍失败。
7. 这证明只根据错误码和 Worker 摘要推根因不可靠；随后改为直接抓 SAME ChatGPT Conversation 的真实 network response / Action call body。

## 5. 真正根因｜VERIFIED

真实 `executeCapability` 请求体包含：

```text
contract ✅
contractVersion ✅
idempotencyKey ✅
correlationId ✅
taskId ✅
nodeId ✅
runNo ✅
capability = file.read ✅
input ❌ 完全缺失
```

因此“缺 taskId/nodeId/runNo”是假设错误，已被真实 wire payload 否定。

Dev Worker Conversation 创建时 pin 的旧 Custom GPT material 约为 `agent-controller-dev 0.1.16`。旧 Action 对 `executeCapability.input` 只有 generic object，无法告诉模型 `file.read` 的 typed input 必须包含 `path`。Worker 又明确执行“不猜未公开参数”的策略，于是省略整个 `input`，Host/Execution 在 durable Execution 创建前返回 `INVALID_REQUEST`。

## 6. canonical contract

`packages/execution-contracts/src/index.ts` 的唯一 `capabilityInputSchemas` 已定义：

```text
file.read:
  path: non-empty relative path / REQUIRED
  encoding: "utf8" / OPTIONAL
  additionalProperties: false
```

Real-3 目标路径固定为 `repos/proflow/package.json`。
## 7. 正确修复

功能提交：`94cec4fe05d3`。

修复不复制第二套协议：

- `execution-contracts` 从现有 canonical Zod `capabilityInputSchemas` 通过 `z.toJSONSchema()` 生成并导出 `executionCapabilityInputJsonSchemas`。
- `platform-host getNodeContext` 对拥有 `executeCapability` 的角色投影 `executionCapabilityInputSchemas`。
- 原有 `executionCapabilityIds` 与 `executionRequestContext` 继续保留。
- exact-node admission 不放宽；错误 Task/Node/run/Role/Worker 仍 fail-closed。

`file.read` 投影已机械验证 `required=["path"]`；37 个 capability 的全部 input schema 序列化约 14 KB。

## 8. 代码 Gate

```text
execution-contracts tests = 9/9 PASS
  包含新增 CP-EXE-CON-01A，锁定 projection 数量与 file.read schema
execution-contracts typecheck = PASS
B1-HOST-EXEC-01 = PASS
platform-host full tests = 58/58 PASS
platform-host typecheck against current source execution-contracts = PASS
Biome = PASS
git diff --check = PASS
canonical targeted build = PASS
release-sync execution-contracts + platform-host = PASS
```

版本提交：`7bcc1ab37fc4`。

```text
execution-contracts package/module/descriptor = 0.1.11
platform-host package/module/descriptor = 0.1.22
Registry exact 0.1.11 = PRESENT
Registry exact 0.1.22 = PRESENT
```

## 9. 交接前新发现的 artifact gate

交接前执行：

`node scripts/publishability.mjs execution-contracts platform-host`

约 147 秒后 exit 1：

`Error: published binary smoke failed: proflow-platform-host`

已知：

- tarball pack 已完成；
- isolated `npm install` 已进入并完成到 binary smoke 阶段；
- 失败发生在 installed `proflow-platform-host --help`；
- 源码 `packages/platform-host/src/cli.ts` 明确处理 `--help/-h` 并 exit 0；
- 本地 build `dist/src/cli.js` 同样明确处理 `--help` 并 exit 0。

因此不能把它简单归类为“gate 不兼容”，也不能直接宣称制品坏了。

```text
ARTIFACT_CLASSIFICATION = UNKNOWN
候选 = REAL_ARTIFACT_BUG | PUBLISHABILITY_HARNESS_FALSE_NEGATIVE
```

下一 Chat 第一件事必须在 Product mutation 前复现**packed isolated binary**，捕获 status/stdout/stderr/module-resolution error，并完成分类。目标版本已经在 Registry，禁止因为这个失败盲目 republish。

## 10. 下一 Chat 主线

```text
A. classify artifact binary smoke
B. if healthy: freeze SAME-SCENE + current installed versions
C. formal stop
D. targeted adopt BOTH execution-contracts@0.1.11 + platform-host@0.1.22
E. installed exact readback
F. Provider/23 setup READY + new restart acceptance
G. exactly one platform start
H. verify getNodeContext file.read input schema required=[path]
I. formal ACK pending event17 blocker -> resume SAME Task
J. Observer normal wake SAME Dev
K. real Action must carry input={path:"repos/proflow/package.json"}
L. durable file.read Execution must exist and succeed
M. Dev SUCCEEDED -> Test independent verify -> Task SUCCEEDED
N. J4 PASS -> REAL_3 PASS
O. final Runbook/CURRENT/history closeout, commit, no push
```

## 11. 禁止动作

- 不手工 wake；不手工创建/retry `file.read` Execution。
- 不新建 Task / Worker / Conversation。
- 不直接改 SQLite。
- 不重新研究 Browser 0.1.50 / COMPOSER_NOT_FOUND。
- 不重新研究 Dev Tunnel 0.1.36 / login / 41705。
- 不扫描 LAN；Provider `.101` 当前 HTTP 200。
- 不复用历史 start acceptance。
- 不盲重发 publish/update/start/stop。
- 不 push。

## 12. 执行效率复盘

本 Chat 最大的效率问题不是模型推理能力，而是**在没有真实请求体前连续把高概率假设升级为 release 级根因**：0.1.20、0.1.21 都提供了有价值的兼容信息，但没有打穿真实 `file.read`。

最终有效路径是：

```text
INVALID_REQUEST + durable Execution 不存在
-> 冻结失败边界在 Action/Host admission
-> 从真实 ChatGPT Conversation network response 提取 Action arguments
-> 对 canonical Execution contract 做字段 diff
-> 发现 input 整体缺失
-> 从唯一 Zod contract 自动投影 typed input JSON Schema
-> targeted/full gate
```

下一 Chat 必须延续这一方法：先证据、后变更；一个 contract boundary 锁定后不再横向回查已 PASS 的 Browser/Tunnel/Model。

非幂等操作仍使用 durable PID/log/result + owner readback；超时只恢复 authority，不盲重发。SQLite 表/列、日志路径、CLI 行为不得临时猜测，应从 schema/owner/runbook 读取。

## 13. 最终交接判定

```text
HANDOFF_READY = YES
REAL_3_PASS = NO
ROOT_CAUSE = VERIFIED
CORRECT_FIX_SOURCE = PASS
CORRECT_RELEASE_PAIR = PRESENT_IN_REGISTRY
PRODUCT_ADOPTION = PENDING
ARTIFACT_BINARY_SMOKE = FAIL / CLASSIFICATION_PENDING
SAME_SCENE = PRESERVED
NEXT_CHAT_FIRST_ACTION = CLASSIFY_PACKED_PLATFORM_HOST_BINARY_SMOKE
PUSH = FORBIDDEN
```

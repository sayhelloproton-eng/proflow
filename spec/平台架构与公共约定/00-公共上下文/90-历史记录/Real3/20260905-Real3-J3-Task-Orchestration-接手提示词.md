# Real-3 J3｜Task Orchestration 接手提示词｜2026-09-05

把本文直接作为下一 Chat 的开场执行上下文。仓库：`/Users/agent/Desktop/proton-workspace/repos/proflow`；Product Workspace：`/Users/agent/Desktop/proton-workspace`。

## 你的角色

你接手 ProFlow Phase 3 Real-3 总控。不要重新部署、重新建资源或重查已关闭问题。当前目标只有：在不破坏 Task Orchestration Frozen 语义的前提下，解决 J3 `worker.wake` Execution identity admission，继续固定 Task 到 J4/REAL_3 PASS。

## 第一原则

**先完整通读 Task Orchestration，再改代码。** 当前已经发现一个高置信候选，但用户明确禁止“看到一行可疑代码就直接修”。你必须先证明 ownership、状态机、runNo fencing 与跨域合同，再决定修法。

## Core 读取顺序

先读公共上下文 Core：`00-公共上下文/README.md` → `01-长期规则/01-总控职责与阶段门禁.md` → `01-长期规则/02-公共上下文治理规则.md` → `01-长期规则/05-执行纪律与工具规则.md` → `02-当前接力/CURRENT.md`。

然后按 CURRENT.REQUIRED_CONTEXT 完整阅读 Task Orchestration normative context。不要先改源码。
## 当前机械事实

- `J1=PASS`，`J2=PASS`；Human Start 已通过官方 Tasks UI **只点一次**，禁止重做。
- 固定 Task：`task-a6f859c00b1accd027d53d48`，当前 `ACTIVE/v7/currentNodeId=dev`。
- Dev Node=`READY/run1`；Test Node=`PENDING/run1`；Product/Dev/Test 三份 TaskRoleBinding exact。
- `execution-browser-extension 0.1.41` 已 Registry/Workspace/loadDir/Chrome runtime 全对齐，同一 Extension ID `eehdadpmjffomabiedcjijiakconalab`。
- 0.1.41 已真实证明：`TASK_OBSERVER_RECOVER=SUCCEEDED`，`execution.listSignals=SUCCEEDED`，`task.projection=SUCCEEDED`。不要重开 Browser Observer recovery wiring。
- `model-runtime 0.1.24` 已闭环；手机 `/v1/models` HTTP 200；`platform setup=3/3`，`PLATFORM_READY=YES`。
- Dev Conversation 尚未收到新的真实 `NODE_READY`。

## 当前唯一 blocker

Observer 已决定 WAKE Dev，但 `task.wake` 失败：`TASK_WAKE_NOT_CONFIRMED:FAILED:NOT_APPLIED`。

对应 durable Execution：`execution:fbc00b27-bf5b-4325-a3ef-4269579fdabd`，capability=`worker.wake`，最终 `FAILED/NOT_APPLIED`；Execution Runtime 明确记录 `ADMISSION_REJECTED / IDENTITY_INVALID`。
## 已核对的 wake request

这条 Execution 的 durable request 中：

- `callerRef=extension:task-observer`
- `taskId=task-a6f859c00b1accd027d53d48`
- `nodeId=dev`
- `runNo=1`
- Dev `roleRef=g-6a9717f68ef081918aacd5911916d2ec`
- Dev `workerRef=6a9b4632-ca8c-83e9-a4bc-9de9e229e515`

以上全部与当前 Task/Node/TaskRoleBinding truth exact match。Dev Role 仍在 Agent Runtime 注册；REQUIREMENT Owner 路径 `.proflow/tasks/task-a6f859c00b1accd027d53d48/documents/requirement.md` 真实存在。

## 高置信候选，但不是已裁决 root cause

Platform Host `authorizeExecution()` 对 `request.nodeId` 会调用 `task.queries.getNodeContext({taskId,nodeId,...runNo})`；Task Orchestration 的正式 `getNodeContext` schema 却是 `z.object({taskId,nodeId}).strict()`。多余 `runNo` 很可能使 query validation 失败，随后被 `authorizeExecution` 的 `catch { return false }` 压成 `IDENTITY_INVALID`。

**不要直接修这一行。** 先证明 Task Orchestration 对 runNo 的正式 fencing 语义与跨域 ownership。
## 任务编排已知 normative 锚点

先用文档验证这些语义，再用当前源码/测试交叉验证：

- Task Domain owns `Task/Node/runNo/TaskRoleBinding/TaskDocument`；不 owns Role/Worker identity 真实性、Browser lifecycle、Execution effect/evidence。
- Node 是 v1 唯一最小业务调度单元；没有 WorkItem/Claim/Lease/parallel Node。
- Node `READY` 时 Task Observer 只 WAKE；真正 `startNode` 必须由被唤醒 Worker 正式调用。
- Node `workerRef` 是 run-level fact，`IN_PROGRESS` 后写入；TaskRoleBinding 是 Task-level 稳定 binding。
- `reopenNode`：target `runNo+1`、READY、run-level workerRef 清空；TaskRoleBinding/Conversation 保留，下一次 startNode 从稳定 binding 解析同一 Worker。
- Execution owns real effect/evidence；Execution/Carrier pending 默认不自动把 Task/Node 改成 WAITING。
- Task Observer 不是 Scheduler，不拥有 Task 状态推进权。

因此绝不能用“忽略 runNo”消除当前 IDENTITY_INVALID。正确修复必须保留 stale-run fencing。

## 下一 Chat 第一份产出

在修改任何生产代码前，先向用户汇报一份**任务编排主链审计结论**：Owner/State/Fencing 图 + 当前 wake 在整链中的位置 + `runNo` 应在哪一层验证 + 当前候选为何成立/不成立。只有确认后再进入 RED。
## 若候选被完整审计确认

先写 targeted RED，至少证明：current run/current worker 应 allow；stale run 必须 deny；wrong worker/role/node 必须 deny。若 RED 精确命中 strict `getNodeContext` input mismatch，再做最小修复：按正式 `{taskId,nodeId}` query 读取 Owner node，并单独比较 `request.runNo === owner.node.runNo`。不要改变 Public Task Contract，不新增 Scheduler/Queue/实体。

修复后按 owning blast radius 跑 targeted/package/typecheck/build；需要发布时走正式 package release + Registry exact + Product Workspace update。回到**同一个** Real-3 checkpoint，不重建资源。

此前 wake Execution 是 `FAILED/NOT_APPLIED`，因此只有在正式 Execution recovery/redecision 语义允许时重试同一 intent；禁止 blind replay。成功判据是 Dev Conversation 中真实出现新的 `NODE_READY` trigger，随后 Worker 正式 `startNode`。

## J3/J4 最终目标

J3：Dev Worker 必须通过正式 Execution 读取 `repos/proflow/package.json` 并报告 package name + version；Controller 本地 `cat` 不能替代 Execution evidence。Dev 完成后 Task Owner 自动推进 Test READY。

J4：Test/Ops 必须被自动 WAKE，并独立通过 Execution 再读取同一文件、验证相同 name/version。最终只有 Owner `Task=SUCCEEDED/currentNodeId=null` 且 Dev/Test execution/history/evidence 闭环，才可写 `REAL_3=PASS`。

## 禁止项

禁止：新 Task/GPT/Execution；重做 Human Start；直接 `task.start`；再次 WORKER_BIND/browser.bindWorker；改 Owner DB；Recover legacy UNKNOWN；重查 Gateway；重开 0.1.41 Browser recovery/adoption；进入 Extension Manager；为了当前 case 放宽 identity/runNo fencing。

Codex：用户规定**不要直接启动**。如确实需要 Codex，只能先向用户说明为什么需要、审计范围、禁止触碰项、预期输出；用户明确确认后才能使用。
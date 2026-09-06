# CURRENT｜Phase 3 当前接力

> 更新时间：2026-09-07。这里是下一 Chat 的唯一滚动执行入口；历史过程见 `90-历史记录/Real3/`。

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

## CURRENT_AUTHORITY

```text
branch = main
HEAD = 0f4e480 chore: release Real-3 B1 runtime fixes
B1 implementation = 06eecbb fix: harden task orchestration recovery semantics
release plan = bcb555c chore: plan Real-3 B1 runtime release
working tree before this closeout = CLEAN
```

B1 已完成实现、全量验证、发布与 Registry exact readback。六个正式版本：

```text
@tomflow/proflow-task-orchestration          0.1.11
@tomflow/proflow-platform-host               0.1.19
@tomflow/proflow-execution-browser-extension 0.1.45
@tomflow/proflow-agent-gateway               0.1.16
@tomflow/proflow-agent-controller-dev        0.1.17
@tomflow/proflow-agent-test-ops               0.1.17
```

Workspace 六包已安装新版本。Browser Extension 已 materialize 并由真实 Chrome 加载 `0.1.45`：Extension ID `eehdadpmjffomabiedcjijiakconalab`，Service Worker `RUNNING`，pairing evidence source=`PAIRING_HEARTBEAT`。materialized `background.js` 已确认包含 `resumeSignalRef`、`TASK_OBSERVER_RESUME`、`TASK_RESUMED`。

## FIXED_REAL3_TRUTH

固定 Task 不重建、不换 Worker、不换 Conversation：

```text
Task = task-a6f859c00b1accd027d53d48
Task status = WAITING
Task version = 9
currentNodeId = dev

Dev role/worker = g-6a9717f68ef081918aacd5911916d2ec / 6a9b4632-ca8c-83e9-a4bc-9de9e229e515
Dev status = WAITING
Dev runNo = 1

Test role/worker = g-6a97186190108191bc24fb85b2cff584 / 6a9b8ae0-f694-83e8-b4a2-0d20cbc5c04a
Test status = PENDING
Test runNo = 1

Product role/worker = g-6a97182669f88191a943e806a3e1b42a / 6a9b243c-7af8-83e9-a005-2ccfb8c5c8cb
J3 wake execution = execution:fbc00b27-bf5b-4325-a3ef-4269579fdabd / SUCCEEDED
```

最后一次 read-only Host 回读与上述事实逐字段一致，并验证 `task.sqlite` 查询前后 SHA-256 未变化。

## CURRENT_BLOCKER

当前 blocker 已从代码/发布层收敛到 **两个既有 Custom GPT 的远端 owner adoption**：

```text
agent-controller-dev installed = 0.1.17
Dev durable Role registration  = 0.1.16 -> DRIFT

agent-test-ops installed        = 0.1.17
Test durable Role registration = 0.1.16 -> DRIFT

platform start = BLOCKED / ROLE_PACKAGE_VERSION_DRIFT
```

正式 adapter 在 DRIFT 状态明确返回 `resolve-custom-gpt-role-drift`，不会自动编辑既有 GPT；MISSING 才允许创建，因此禁止通过 setup 新建替代 GPT。

真实 Chrome 进一步确认：

```text
current ChatGPT login = Sayhello Plus
Dev GPT page creator  = community builder
Dev GPT 操作菜单无“编辑 GPT”
/gpts/mine 不包含该 Dev/Test Role GPT
CURRENT_CHATGPT_ACCOUNT_IS_GPT_OWNER = NO
```

因此不能只把本地 `roles.json` 的 registeredPackageVersion 改成 `0.1.17`；那会制造假 adoption，让 platform start 表面通过但远端 Instructions/Action/OpenAPI 仍旧。

Chrome `Default` profile 历史记录存在三个 ProFlow GPT 的 `/gpts/editor/<gid>` 访问记录；`Profile 1` 无对应历史。当前只读 Cookie 路径检查返回 `NO_COOKIE_DB`，不能据此判定另一个 profile 是否保留 owner session。Owner 登录态仍需恢复/确认。

## NEXT_ACTION

只沿这一条线继续：

1. 恢复或切换到拥有现有 ProFlow GPT 的 ChatGPT owner 登录态；当前页面 creator=`community builder` 是关键证据。
2. 在 **原 roleRef** 上更新 Dev GPT 到 `agent-controller-dev@0.1.17` 的当前 Instructions + Action/OpenAPI；不得新建 GPT。
3. 在 **原 roleRef** 上更新 Test/Ops GPT 到 `agent-test-ops@0.1.17`；不得新建 GPT。
4. 重新执行正式 Role setup/status，使两个 durable Role registration 真实变为 READY / `0.1.17`。
5. 恢复 dev-tunnel / agent-gateway / platform runtime，要求 `platform start` 全平台 READY。
6. fresh read 固定 Task，必须仍为 `WAITING v9 / Dev WAITING run1 / Test PENDING run1`。
7. 然后才执行 SAME-SCENE：ACK 原错误 blocker -> `task.resume` same-run -> Dev durable `file.read` -> complete Dev -> Test 自动 wake/start -> Test durable `file.read` -> complete Test。
8. 只有 Task Owner 最终 `SUCCEEDED / currentNodeId=null` 才宣告 `J4=PASS / REAL_3=PASS`。

## SAFETY / DO_NOT_REPEAT

```text
TASK_ACKNOWLEDGED = NO
TASK_RESUMED = NO
NODE_REOPENED = NO
NODE_STARTED_AFTER_B1 = NO
NODE_COMPLETED_AFTER_B1 = NO
EXECUTION_CREATED_FOR_REAL3_AFTER_B1 = NO
SQLITE_MUTATED = NO
NEW_GPT_CREATED = NO
PUSHED = NO
```

- 不再重审 B1 源码；`06eecbb` 已完成 build/typecheck/tests/architecture/governance/publishability/Repomix 审计。
- 不再重复 publish 六包；Registry exact 已闭环。
- 不再 reload Extension 证明版本；Chrome `0.1.45` actual adoption 已闭环。
- 不允许绕过 `ROLE_PACKAGE_VERSION_DRIFT`，也不允许伪改 Role registry。
- 不创建新 Task/GPT/Worker/Execution，不重放 J3 WAKE，不默认 Reopen WAITING Node。

## REQUIRED_CONTEXT

下一执行者先读：

1. `01-长期规则/05-执行纪律与工具规则.md`
2. `03-自动化知识库/基础动作/Browser-UI自动化.md`
3. `03-自动化知识库/包能力/custom-gpt-provisioning.md`
4. `03-自动化知识库/流程/Package-Update-Loop.md`
5. `90-历史记录/Real3/23-Real3-B1发布采用与CustomGPT-Owner阻塞-20260907.md`

## STOP_POINT

`J1_PASS / J2_PASS / J3_PASS / B1_RELEASED / REGISTRY_PASS / WORKSPACE_PACKAGE_ADOPTION_PASS / CHROME_EXTENSION_0.1.45_PASS / DEV_TEST_CUSTOM_GPT_OWNER_ADOPTION_BLOCKED / FIXED_TASK_UNMUTATED / SAME_SCENE_NOT_STARTED`。

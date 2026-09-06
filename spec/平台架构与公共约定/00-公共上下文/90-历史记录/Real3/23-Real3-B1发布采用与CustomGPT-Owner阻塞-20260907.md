# Real-3｜B1 发布采用与 Custom GPT Owner 阻塞｜2026-09-07

## 1. 结论

B1 已从源码修复推进到正式 npm 发布、Registry exact readback、Workspace package materialization 和 Chrome Extension actual adoption。J4 尚未进入 SAME-SCENE；当前唯一主 blocker 是两个既有 Dev/Test Custom GPT 无法在当前 ChatGPT 登录身份下编辑，导致远端 Role package adoption 仍停在旧版本。

```text
REAL_3 = IN_PROGRESS
J1 = PASS
J2 = PASS
J3 = PASS
J4 = IN_PROGRESS
```

## 2. Git / Release Authority

```text
B1 implementation commit = 06eecbb
handoff context commit    = d19110d
release plan commit       = bcb555c
release commit            = 0f4e480
```

正式发布六包：

```text
task-orchestration          0.1.10 -> 0.1.11
platform-host               0.1.18 -> 0.1.19
execution-browser-extension 0.1.44 -> 0.1.45
agent-gateway               0.1.15 -> 0.1.16
agent-controller-dev        0.1.16 -> 0.1.17
agent-test-ops               0.1.16 -> 0.1.17
```

六个 `npm view <package>@<version>` exact readback 均 PASS。首次 `package:release` 汇总因 Registry 传播窗口 exit 1，但 publish 日志成功；后续只读 exact 查询全部可见，未进行第二次 publish。

## 3. Workspace / Extension Adoption

六包 `declared / installed / descriptor` 均精确命中新版本。Extension：

```text
version = 0.1.45
loadDir = /Users/agent/Desktop/proton-workspace/.proflow/deployment/browser-extension/execution-browser-extension
extensionId = eehdadpmjffomabiedcjijiakconalab
serviceWorker = RUNNING
evidenceSource = PAIRING_HEARTBEAT
```

Chrome reload 前卡片为 `0.1.44`，reload 后真实卡片为 `0.1.45`；materialized `background.js` 包含 `resumeSignalRef / TASK_OBSERVER_RESUME / TASK_RESUMED`。因此 `CHROME_ACTUAL_ADOPTION=YES`。

## 4. 固定 Task 保护

只读 Host fresh readback：

```text
Task = task-a6f859c00b1accd027d53d48
status = WAITING
version = 9
currentNodeId = dev
Dev = WAITING / runNo=1 / workerRef=6a9b4632-ca8c-83e9-a4bc-9de9e229e515
Test = PENDING / runNo=1 / workerRef=null
```

查询前后 `task.sqlite` SHA-256 未变化。没有 ACK/resume/reopen/start/complete/fail/Real-3 Execution。

## 5. Custom GPT Drift

Workspace package 已是新版本，但 Durable Role registration：

```text
Dev 0.1.16 -> expected 0.1.17 = DRIFT
Test 0.1.16 -> expected 0.1.17 = DRIFT
```

正式 setup 返回 `ACTION_REQUIRED / resolve-custom-gpt-role-drift / OBSERVED_EFFECTS=0`。源码合同明确：DRIFT 不自动编辑现有 GPT，MISSING 才创建新 GPT。

## 6. Owner 现场新证据

真实 Chrome 打开原 Dev Role GPT：

```text
roleRef = g-6a9717f68ef081918aacd5911916d2ec
page = 研发 + 项目总控
creator = community builder
current ChatGPT login = Sayhello Plus
```

操作菜单只有“置顶 GPT”，没有“编辑 GPT”；`/gpts/mine` 也没有 Dev/Test Role GPT。因此当前登录身份不是这些 GPT 的 owner。

本机 Chrome profile：`Default` 历史记录中存在三个 ProFlow GPT 的 `/gpts/editor/<gid>`；`Profile 1` 无对应历史。Cookie DB 探测未取得有效数据库，只能记为未知，不能宣称另一个 profile 已登出或未登录。

## 7. 禁止的错误恢复

- 禁止直接把 `roles.json` 版本号从 0.1.16 改成 0.1.17；这会伪造远端 adoption。
- 禁止新建 Dev/Test GPT 替代旧 roleRef；会破坏 stable TaskRoleBinding / Worker Conversation。
- 禁止为了让 `platform start` 通过而绕过 `ROLE_PACKAGE_VERSION_DRIFT`。
- 禁止触碰固定 Task，直到两个现有 GPT 完成真实 remote adoption 且全平台 runtime READY。

## 8. 下一步唯一顺序

```text
恢复 GPT owner 登录态
-> 更新原 Dev GPT 到 0.1.17 material
-> 更新原 Test/Ops GPT 到 0.1.17 material
-> Role registration READY 0.1.17
-> 恢复 tunnel/gateway/platform runtime
-> fresh Task readback
-> ACK 原错误 blocker
-> same-run resume Dev
-> Dev durable file.read + complete
-> Test auto wake/start
-> Test durable file.read + complete
-> Task SUCCEEDED / currentNodeId=null
-> J4 PASS / REAL_3 PASS
```

## 9. Stop Point

```text
RELEASE=PASS
REGISTRY=PASS
WORKSPACE_PACKAGE_MATERIALIZATION=PASS
CHROME_EXTENSION_ADOPTION=PASS
CUSTOM_GPT_REMOTE_ADOPTION=BLOCKED_BY_OWNER_LOGIN
PLATFORM_FULL_START=BLOCKED_BY_ROLE_PACKAGE_VERSION_DRIFT
REAL3_TASK_MUTATED=NO
READY_FOR_REAL3_SAME_SCENE=NO
```

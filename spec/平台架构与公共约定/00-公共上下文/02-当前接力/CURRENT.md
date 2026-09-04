# CURRENT｜Phase 3 当前接力

> 更新时间：2026-09-04。这里是下一 Chat 的唯一滚动执行入口；旧 handoff 只在 `90-历史记录`。

## CURRENT_STAGE

```text
ARCHITECTURE = FROZEN
REAL_1 = PASS
REAL_2 = PASS / FROZEN
DEPLOYMENT_SUCCESS = YES / FROZEN
CURRENT_EXECUTION_GATE = REAL_3_J0_J4
PHASE3_FINAL_GO = NO
REAL_3 = NOT_PASS
```

## FINAL_GOAL

完成 Real-3 J0→J4 的真实“人工视角自动化”验收。Deployment 已封版；Real-3 中发现的真实缺陷只做 owning package 最小修复，不重开 Deployment，不重建已有 GPT。

## CURRENT_AUTHORITY_SNAPSHOT

```text
branch = main
HEAD = c85e986b56eca8be3e5c016a14bc1470ee656d87
Product Workspace = /Users/agent/Desktop/proton-workspace
current source execution-browser-extension = 0.1.37 candidate
Registry latest execution-browser-extension = 0.1.36
Registry exact 0.1.37 = E404 / NOT PUBLISHED
Workspace materialized extension = 0.1.36
verification moduleVersion = 0.1.36
platform runtime processes = STOPPED
CURRENT_CHECKPOINT = REAL_3_J1_CONTENT_SCRIPT_BUILD_REPAIR
Task = task-a6f859c00b1accd027d53d48
```
## J0 FIXED ROLE AUTHORITY

```text
研发 + 项目总控 = g-6a9717f68ef081918aacd5911916d2ec
运营 + 产品经理 = g-6a97182669f88191a943e806a3e1b42a
部署 + 测试验收 = g-6a97186190108191bc24fb85b2cff584
```

禁止创建第 4/5/6 个 GPT；禁止删除/重建当前三个。产品代码继续 create-only；已有 GPT 的 auth repair 仅走既有 Real-3 manual repair path。

## ROOT_CAUSE_A_CLOSED｜Browser command poll auth

真实 Chrome 网络抓证确认：`POST /v1/session/hello` 会带 `Origin: chrome-extension://...`，但真实 `GET /v1/commands/next` 不带 Origin。旧 Runtime/Pairing Bridge 对每个请求都强制 Extension Origin，导致 hello=200、poll=401，handler 前失败，`lastCommandPollAt=null`。

`0.1.36` 已正式修复认证边界：HELLO 仍必须 Bearer + 精确 Extension Origin + extensionId；后续 session-bound 请求必须 Bearer + 正确 extensionInstanceId，Origin 若存在仍必须精确匹配，但允许 Chrome 真实 originless GET poll。

真实验证已通过：

```text
Registry exact/latest = 0.1.36
Workspace/materialized/verification = 0.1.36
Runtime sessionOnline=true
Runtime commandConsumerReady=true
t0 consumerReady=true
t+12s consumerReady=true
same extensionInstanceId=true
ZERO_COMMAND_LIVENESS_PASS=true
platform status 曾达到 PLATFORM_READY=YES
```

因此“假 online / command consumer 不 poll” blocker 已关闭。
## CURRENT_BLOCKER｜Content Script build artifact

平台启动后 Observer Recovery 自动重驱同三条 stable `worker.create`。Browser transport 已越过旧 timeout；最新 durable reality：

```text
Product execution:c3fc60b1-74fc-4cfb-bf45-c9ae18602631
  FAILED + NOT_APPLIED, attemptCount=8
  DECISION_UNRESOLVED: INVALID_OUTPUT
Dev execution:a510cb5d-2a65-419f-bd7e-254b9d77cdc4
  FAILED + NOT_APPLIED, attemptCount=7
  CONTENT_SESSION_TIMEOUT
Test execution:567be187-f585-4d08-bb33-6fbe25e84aed
  FAILED + NOT_APPLIED, attemptCount=6
  CONTENT_SESSION_TIMEOUT
bindings = all workerRef=null / conversationLocator=null
```

真实 Chrome 已出现多份三个 GPT 的 Role 根页 `/g/g-...`，但没有任何 `/c/<conversation>`。因此 `effectStartedAt=null` 只能证明 WORKER_BIND business effect 未开始，不能证明 Browser 没创建 Tab。禁止盲目 Recover。

`CONTENT_SESSION_TIMEOUT` 的根因已由发布物机械确认：materialized `dist/extension/content.js` 第一行仍有 `import { containsSubmittedFingerprint } ...`，但 manifest content script 是 classic script；`provisioning-content.js` 已正确 bundle 为 IIFE。主 Content Script 因 build pipeline 未 bundle，无法正常注入/publish `PROFLOW_CONTENT_OBSERVATION`。

当前源码候选已修 `scripts/build-packages.mjs`：`extension/content.ts` 与 provisioning content 一样使用 esbuild `--bundle --format=iife --platform=browser`，并硬校验产物无 ESM。对应契约测试已补 RED→GREEN。

真实 build readback：

```text
content.js prefix = "use strict"; (() => { ... })();
HAS_ESM=false
HAS_FINGERPRINT_IMPL=true
package gate = 108/108 PASS
typecheck = PASS
publishability = PASS
full command exit = 0
```

源码 version 已同步为 `0.1.37`，但 Registry exact 0.1.37 当前 E404，latest 仍 0.1.36；因此 **0.1.37 尚未 publish/update/reload/revalidate**。
## NEXT_ACTION

1. 不重新审计已关闭的 Origin/poll 根因。先确认 source `0.1.37` candidate diff，仅针对 Browser Extension/build pipeline 做发布前审计；Registry 0.1.37 已机械证明空位。
2. 唯一一次 publish `@tomflow/proflow-execution-browser-extension@0.1.37`；若结果不明确只查 Registry，不盲重发。
3. 单包 update 到 Product Workspace，确认 materialized manifest 0.1.37；Chrome privileged reload；先启动 setup/pairing server再唤醒 Extension，verification 必须回读 0.1.37。
4. 在恢复平台前，先 reconcile/清理当前遗留的重复 Role 根页；没有 `/c/` Conversation，禁止把这些根页误认为 Worker binding 成功。不要创建新 GPT/Task/Execution。
5. `platform start` 后立即观察 Observer 自动 Recovery：Content Script 应发布 observation，OPEN 不应再 `CONTENT_SESSION_TIMEOUT`。注意启动本身可能自动 retry，不要同时手点 Recover。
6. 只有 Owner + Browser reality 确认自动 Recovery 未推进或安全停在 `FAILED + NOT_APPLIED` 时，才考虑同一 Task 的一次 Recover；必须复用 stable executionRef。
7. J1 通过标准：三个原 GPT 各出现真实 `/g/<gid>/c/<cid>` Conversation，Browser 中能看到真实 WORKER_BIND user message，TaskRoleBinding 持久化 `workerRef + conversationLocator`，Browser reality 与 Owner 一致。
8. J1 后继续 J2 Confirm/Start → J3 deterministic WAKE → J4 autonomous Agent Loop。
9. 用户要求：目标完成后必须做一次独立变更审计，确认本轮 0.1.33→0.1.37 修复没有引入认证、readiness、pairing、MV3、Content Script、Observer Recovery、timeout/no-blind-replay 等新问题。

## DO_NOT_REPEAT

- 不 Fresh Workspace，不重新 install，不重开 Deployment。
- 不创建第 4/5/6 个 GPT，不删除/重建当前三个。
- 不创建新 Real-3 Task；固定 taskId 继续使用。
- 不因为 bindings 为空就断言 Browser 无副作用；OPEN 已经留下多份 Role 根页。
- 不在 platform start 后立刻手点 Recover；先看 startup Observer Recovery 是否已自动重驱。
- 不回到“调大 timeout / MV3 猜测 / 204 framing / Model prompt”继续钻；Browser poll auth 根因已被真实 Chrome 网络证据关闭。
- 不 reset/clean/revert dirty worktree 的无关内容。
- `platform stop` 上一次业务 runtime 已退出但 CLI 壳曾悬挂；当前无 active sessions、无 platform runtime processes。

## REQUIRED_CONTEXT

1. `00-公共上下文/README.md`
2. `01-长期规则/05-执行纪律与工具规则.md`
3. `02-当前接力/CURRENT.md`
4. `03-自动化知识库/流程/Real3-J0-J4.md`
5. `90-历史记录/Real3/18-Real3当前Chat交接-20260904.md`
6. `90-历史记录/Real3/19-下一个Chat提示词-Real3-J1继续-20260904.md`

新 Chat 先读 CURRENT + 18；19 是可直接作为开场指令使用的执行提示词。
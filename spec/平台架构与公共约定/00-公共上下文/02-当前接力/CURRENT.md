# CURRENT｜Phase 3 当前接力

> 更新时间：2026-09-04 23:03。这里是下一 Chat 的唯一滚动执行入口；旧 handoff 只在 `90-历史记录`。

## CURRENT_STAGE

```text
ARCHITECTURE = FROZEN
REAL_1 = PASS
REAL_2 = PASS / FROZEN
DEPLOYMENT_SUCCESS = YES / FROZEN
CURRENT_EXECUTION_GATE = REAL_3_J0_J4
REAL3_BROWSER_CARRIER_AUTOMATED_TEST_GATE = PASS
REAL_3 = NOT_PASS
PHASE3_FINAL_GO = NO
```

## FINAL_GOAL

完成固定 Real-3 Task 的 J1→J4 真实“人工视角自动化”验收。Deployment 不重开；真实缺陷只做 owning package 最小修复。真实 Browser 每个关键状态必须用 screenshot + DOM/AX reality 观察，截图就是眼睛。

## CURRENT_AUTHORITY_SNAPSHOT

```text
branch = main
HEAD = 629e0dbd78e06325831883b24dc6b859ed0edef0
Product Workspace = /Users/agent/Desktop/proton-workspace
Registry execution-browser-extension = 0.1.38 VERIFIED
Registry platform-host = 0.1.17 VERIFIED
Workspace execution-browser-extension = 0.1.38 VERIFIED
Workspace platform-host = 0.1.17 VERIFIED
Chrome ProFlow Execution Browser = 0.1.38
Extension ID = eehdadpmjffomabiedcjijiakconalab
CURRENT_CHECKPOINT = REAL_3_J1_EXTENSION_FRESH_ERROR_REPRODUCTION
```

## FIXED_REAL3_RESOURCES

```text
Task = task-a6f859c00b1accd027d53d48
Title = Real-3 read-only smoke
Product role = g-6a97182669f88191a943e806a3e1b42a
Dev role = g-6a9717f68ef081918aacd5911916d2ec
Test role = g-6a97186190108191bc24fb85b2cff584
Product execution = execution:c3fc60b1-74fc-4cfb-bf45-c9ae18602631
Dev execution = execution:a510cb5d-2a65-419f-bd7e-254b9d77cdc4
Test execution = execution:567be187-f585-4d08-bb33-6fbe25e84aed
```

禁止创建新 GPT / Task / Execution。旧 worker.create 曾进入 UNKNOWN：Product attempt 11、Dev attempt 10、Test attempt 9；TaskRoleBinding 仍为 null。**UNKNOWN 禁止第二次盲 Recover。**

## BROWSER_CARRIER_AUTOMATED_BASELINE

以下已完成三轮实现 + Codex 实现审计 + 主 Chat 独立审计，不要无证据重开：

```text
Composer controlled submit                  PASS
Permission semantic detection               PASS
AUTO_ALLOW / DEFER / HUMAN_REQUIRED          PASS
strict Role/Gateway/operation/context policy PASS
Carrier Attention primary /tasks bridge      PASS
MV3 attention rebuild + occurrence identity  PASS
Human Deny precedence / no auto resume       PASS
Observer no-blind-replay / denial guard      PASS
Extension full tests                         148/148 PASS
Platform Host full tests                     52/52 PASS
```

## FROZEN_RUNTIME_MENTAL_MODEL

```text
① Deployment      = 把系统装起来 / 创建固定 Role GPT
② Workflow        = Task/Node/Worker 正式流转
③ Collaboration   = Agent A↔B 独立消息投递
④ System Observer = 全局异常观察 / 诊断 / 恢复建议

共享 Browser Carrier
= Tab/Conversation + Page Reality + Composer + Blocker/Permission
+ Semantic Action + Reality Verification + Recovery + Human Attention
```

Carrier Permission != Execution/Workflow Approval。Content 不拥有 trust policy；Platform Host 做 authoritative classification；Observer 不理解 ChatGPT DOM。

## RELEASE_AND_MATERIALIZATION_CLOSED

Browser Carrier hardening 最终代码链：

```text
2e6bbd8 refactor(browser): harden Real-3 carrier reality
412d24a fix(browser): close Real-3 carrier lifecycle gaps
edc918f fix(browser): preserve human deny across carrier recovery
341fef6 chore(release): queue browser carrier hardening
629e0db chore(release): version execution-browser-extension, platform-host
```

Registry 已真实存在 `execution-browser-extension@0.1.38`、`platform-host@0.1.17`；Product Workspace 已 update 到同版本。repo build、Workspace `node_modules`、`.proflow/deployment/browser-extension` 的 `background.js/content.js` SHA 已一致。版本/物化问题已关闭。

## CURRENT_BROWSER_REALITY

保留旧失败现场，不要手工修：

```text
Product root GPT
  real user messages = 0
  composer draft = WORKER_BIND ...:@tomflow/proflow-agent-test-ops
Dev old conversation
  real user message = WORKER_BIND ...:@tomflow/proflow-agent-product
  getTask Permission 卡片仍存在
Test old conversation
  real user message = WORKER_BIND ...:@tomflow/proflow-agent-controller-dev
  getTask Permission 卡片仍存在
```

这些是旧 composer one-step-lag / permission 故障证据，不是 0.1.38 新执行结果。不要点 Dev/Test 旧 Permission，不要清旧 Chat，不要第二次 Recover。

## CURRENT_BLOCKER｜先区分历史 Extension Error 与 fresh 0.1.38 error

0.1.38 已在真实 `chrome://extensions` 显示并 reload，但 `platform setup` 等不到 pairing，真实结果 `PAIRING_TIMEOUT`。Extension 卡片显示“错误”。

用户打开 `chrome://extensions/?errors=eehdadpmjffomabiedcjijiakconalab` 后截图看到：

```text
Uncaught SyntaxError: Cannot use import statement outside a module
context = ChatGPT GPT page
stack/source = dist/extension/content.js:1
另有 sendMessage undefined / Failed to fetch 历史记录
```

但当前 0.1.38 materialized `content.js` 已机械读回为 classic IIFE：开头 `"use strict"; (() => { ... })`，residual import=0；`background.js` residual import=0，三份产物 hash 一致。错误详情源码 preview 也已经显示 IIFE。Chrome 会保留历史 Extension error，因此 **当前不能把该 SyntaxError 直接判成 0.1.38 fresh root cause**。

正确 checkpoint 是 fresh reproduction，而不是继续改 build。

## NEXT_ACTION

1. 不改代码、不 Recover、不点旧 Permission。先在 privileged Chrome UI 对当前 Extension error 页做截图/AX readback。
2. 清空该 Extension 的历史错误记录。
3. 启动新的 `platform setup`，让 pairing server **先监听**；记录本轮 PID/输出，UNKNOWN 不盲重跑。
4. pairing server 已进入等待后，用 canonical `browser-extension-ui.mjs reload` 唤醒真实 0.1.38。
5. reload 现有 Product GPT 根页一次，触发当前 `content.js` 注入；不要创建新业务 Tab。
6. 立即再打开 `chrome://extensions/?errors=eehdadpmjffomabiedcjijiakconalab`，用 AX + screenshot 只读取 fresh errors。
7. 若 fresh `Cannot use import...` 再出现：证明还有另一加载路径/旧 artifact，按当前加载 path 与 source URL 精确定位；若不再出现：历史 Content Script error 关闭，不得回头继续改 bundle。
8. 同时回读 setup pairing。若 pairing 仍 timeout 且无 fresh Content Script error，再从 Background `runtime-config → hello → first poll → heartbeat` 真实链逐层抓 fresh evidence，不猜 Service Worker root cause。
9. 只有 Extension pairing/runtime READY 后才恢复 `platform start`，先观察 startup Observer Recovery；禁止同时手点 Recover。
10. J1 仍只认：三个固定 Role 各形成正确 `/g/<gid>/c/<worker>`、真实正确 WORKER_BIND user message、TaskRoleBinding 与 Browser reality 一致、零新增 UNKNOWN。

## DO_NOT_REPEAT

- 不把 Chrome 卡片“错误”直接等同当前 Service Worker 根因；必须进入 errors detail。
- 不把 errors detail 中历史记录直接等同当前版本 fresh failure；必须清空后重现。
- 不因 setup `PAIRING_TIMEOUT` 就反复 reload/setup；先恢复本轮 pairing authority。
- 不重复发布 0.1.38 / 0.1.17；Registry 与 Workspace 已闭环。
- 不重开 Browser Carrier 三轮架构/测试审计，除非 fresh runtime evidence 指向其中。

## REQUIRED_CONTEXT

1. `00-公共上下文/README.md`
2. `01-长期规则/05-执行纪律与工具规则.md`
3. `02-当前接力/CURRENT.md`
4. `03-自动化知识库/基础动作/Browser-UI自动化.md`
5. `03-自动化知识库/包能力/execution-browser-extension.md`
6. `03-自动化知识库/流程/Real3-J0-J4.md`
7. `90-历史记录/Real3/20-Real3当前Chat交接-20260904.md`
8. `90-历史记录/Real3/21-下一个Chat提示词-Real3-J1继续-20260904.md`

新 Chat 先读 CURRENT + 20；21 可直接作为开场执行指令。旧 18/19 已被本轮新事实替代，只用于追历史。

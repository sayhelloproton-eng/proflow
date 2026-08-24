# Real-2 B6｜Extension 实测计划与新 Chat 交接

日期：2026-08-24

## 1. 当前最高优先级状态

```text
ARCHITECTURE = FROZEN
READY_FOR_SMOKE = YES
REAL_1 = PASS
CURRENT_STAGE = REAL_2 / B6
REAL2_B1_B5_FROZEN = YES
REAL2_PROVISIONING_GO = NO
```

B1～B5 已正式封板并提交：

```text
commit = 1d458f1000c0
message = feat(real2): freeze custom gpt provisioning b1-b5
branch = main
working tree = CLEAN（提交后）
```

B6 现在定义为：**真实 Extension 产品路径验证 + 最终真实人工验收**，不是继续做架构设计。

本轮最新决策：**先不 publish，不上 Registry/Fresh Workspace；先证明真实 ProFlow Extension 能在真实 ChatGPT 中创建并配置 Custom GPT。**
## 2. 已经完成的 Chrome for Testing 实机证据

当前已确认：

```text
Chrome for Testing = 152.0.7977.54 mac-x64
固定 profile = /Users/agent/.proflow/browser-test/real2-profile
remote debugging = 127.0.0.1:9229
ChatGPT 登录态 = 已完成并写入固定 profile
```

当前轻量启动参数真实包含：

```text
--user-data-dir=/Users/agent/.proflow/browser-test/real2-profile
--load-extension=/Users/agent/Desktop/proton-workspace/repos/proflow/packages/execution-browser-extension
--disable-extensions-except=/Users/agent/Desktop/proton-workspace/repos/proflow/packages/execution-browser-extension
--remote-debugging-port=9229
```

CDP 已真实观察到：

```text
PROFLOW_EXTENSION_SERVICE_WORKER = PASS
extensionId = elbbglnajonbgmcicnldiemidlloiimc
serviceWorker = chrome-extension://elbbglnajonbgmcicnldiemidlloiimc/dist/extension/background.js
CHATGPT target = PRESENT
```

结论：Chrome for Testing 可以通过启动参数直接加载真实 unpacked ProFlow Extension；不需要用户进入 `chrome://extensions` 手工 Load unpacked。
## 3. B6 第一阶段：先不发包，先打通 Extension 创建智能体

目标不是验证 CLI/Registry，而是先回答：

> 当前仓库中的真实 ProFlow Extension，能否在真实 ChatGPT 登录态中，自动创建并配置一个完整 Custom GPT？

第一阶段只测 `agent-product`，不同时跑三个 Agent。

固定路径：

```text
真实 ProFlow Extension
→ 真实 ChatGPT /gpts/editor/*
→ PROVISION_CUSTOM_GPT
→ Instructions
→ Knowledge upload + processing
→ GPT-5.6 Sol
→ Capabilities
→ Action Schema
→ Private create/promote
→ 返回真实 g-id
```

第一轮先证明“创建 GPT”本身；不要一开始就把 Registry、Role、Gateway、publish、Fresh Workspace 全部叠加进来。

Chrome/CDP 只负责观察、取证、打开页面、检查最终现实；**禁止代替 ProFlow Extension 填写 GPT Editor 字段。**
## 4. 第一阶段 PASS 条件

必须同时满足浏览器现实与本机现实：

```text
EXTENSION_DEPLOYED = YES
EDITOR_OPENED_BY_EXTENSION = YES
INSTRUCTIONS = MATCH
KNOWLEDGE = UPLOADED_AND_PROCESSED
MODEL = GPT-5.6 Sol (gpt-5-6)
CAPABILITIES = MATCH
ACTION_SCHEMA = MATCH
PRIVATE_GPT_CREATED = YES
LIVE_G_ID = PRESENT
DUPLICATE_CREATED = 0
```

验证方式：

```text
Chrome/CDP → 看真实 Editor / GPT live 页面 / network reality
Local Dev  → 看 provisioning bridge / host / evidence / logs
Extension  → 必须自己执行产品动作
```

如果失败，先记录：失败步骤、页面现实、Extension/bridge 现实、可复现方式和 fail class；**不要边测边随手修改源码。**

B1～B5 已封板。B6 只有出现具体、可复现、属于 B6 的实现 blocker 时，才允许进入修复讨论。
## 5. 第一阶段通过后的顺序

只有 Extension → ChatGPT → Product GPT 创建真实 PASS 后，才继续：

```text
阶段 A：Product 创建 PASS
→ 阶段 B：registerRole + Role Bearer + FINALIZE_CUSTOM_GPT_AUTH
→ 阶段 C：真实 Gateway authenticated probe
→ 阶段 D：同一 Product 再跑一次 provisioning，验证 NO DUPLICATE / reentrancy
→ 阶段 E：扩展到 Controller/Dev + Test/Ops
→ 阶段 F：三个 Agent 全 READY
```

阶段 B～D 仍然不需要 publish；继续直接使用当前仓库真实 Extension 和 Agent material。

必须证明：

```text
REAL_EXTENSION_PROVISIONING = PASS
REAL_EXTENSION_AUTH_FINALIZE = PASS
REAL_EXTENSION_REENTRANCY = PASS
```

第二次 provisioning 必须观察已有 GPT/Role 并复用或修正，不能创建第二个 GPT。

## 6. 最后才进入真实发包 / Fresh Workspace

只有上面的 Extension 产品路径全部通过，才允许进入真实 release/publish。
真实部署人工验收顺序按用户最新决定：

```text
1. 部署 Extension
2. 确认 Extension hello / heartbeat / provisioning capability
3. platform install / setup
4. 自动创建 3 个 Private GPT
5. Knowledge / model / capabilities / schema
6. g-id → registerRole → Bearer → FINALIZE auth
7. Gateway probe
8. 3 Agent READY
9. platform start
10. reopen / retry / no duplicate / runtime regression
```

这一步才进入 Registry / Fresh Workspace，并从“真实新用户”视角完整重跑。

最终才允许裁决：

```text
REAL2_PROVISIONING_GO = YES
```

否则只能给出真实、具体、可复现 blocker。

## 7. B6 测试纪律

- 不要在 Extension 创建链路打通之前 publish。
- 不要用 Playwright/Chrome MCP 代替产品填写 Custom GPT Editor。
- 不要修改或删除 `/Users/agent/.proflow/browser-test/real2-profile`。
- 不要读取、打印、记录 Role Bearer、tunnel token 或其它真实凭据。
- 不要为了 B6 推翻 B1～B5 已冻结架构。
- 失败先取证、归类，再决定是否修复；不要测试过程中无限扩散。
- Chrome for Testing 只作为 B6 人工验收浏览器；真实产品动作必须由 ProFlow Extension 完成。
- 当前测试浏览器若仍在运行，不要主动关闭；如需重启，必须复用同一 `real2-profile`。
- `/tmp/proflow-cft-152/...` 是当前测试浏览器二进制位置，属于临时目录；下一 Chat 必须先验证存在性，不要假设永久存在。

## 8. 下一 Chat 开场提示词

将下面整段作为新 Chat 的第一条消息：

```text
接管 ProFlow Phase 3 / Real-2 / B6 真实 Extension 验证。

仓库：
/Users/agent/Desktop/proton-workspace/repos/proflow

第一件事先读：
/Users/agent/Desktop/proton-workspace/repos/proflow/spec/平台架构与公共约定/00-公共上下文/
尤其是：
09-Real2-B6-Extension实测计划与新Chat交接.md
以及 B1～B5 封板基线与 Real-2 测试计划。

当前正式基线：
main@1d458f1000c0
REAL_1 = PASS
REAL2_B1_B5_FROZEN = YES
CURRENT_STAGE = REAL_2 / B6
REAL2_PROVISIONING_GO = NO
```

```text
用户最新决定：
不要先 publish。
先直接验证当前真实 ProFlow Extension 能否在真实 ChatGPT 中自动创建智能体；这条路径打通后，再进入真实发包和 Fresh Workspace 人工视角验收。

部署顺序已确定：第一步就是部署 Extension。

当前 Chrome for Testing 已完成实机验证：
- 固定 profile：/Users/agent/.proflow/browser-test/real2-profile
- ChatGPT 已登录
- remote debugging：127.0.0.1:9229
- ProFlow Extension 通过 --load-extension 真实加载
- extensionId：elbbglnajonbgmcicnldiemidlloiimc
- MV3 Service Worker 已真实出现

新 Chat 接管后先做只读基线检查：
1. git branch / HEAD / status；不要修改代码。
2. 检查 Chrome for Testing 是否仍运行、9229 是否可用、ChatGPT target 是否存在。
3. 检查 ProFlow Extension service worker 是否仍存在。
4. 不要关闭测试浏览器，不要删除/替换 real2-profile。
5. 不要读取或输出任何 token / Role Bearer / credential。

随后直接进入 B6 第一阶段：只测 Product 单 Agent。
使用当前仓库真实 agent-product provisioning material 和真实 provisioning host/bridge 产品入口触发 PROVISION_CUSTOM_GPT。
Chrome/CDP 只能观察和取证，禁止替 Extension 填 Instructions、Knowledge、Model、Capabilities、Action Schema 或点击产品本应自动完成的创建动作。

第一阶段必须真实证明：
Extension 自己打开 /gpts/editor/* → 填完整配置 → 上传并处理 Knowledge → 选择 GPT-5.6 Sol → 安装 Action Schema → 创建 Private GPT → 返回真实 g-id。
```

```text
PASS 后再继续：
registerRole → Role Bearer → FINALIZE_CUSTOM_GPT_AUTH → Gateway probe → 同一 Product 重跑验证 no duplicate/reentrancy → 再扩到另外两个 Agent。

只有 REAL_EXTENSION_PROVISIONING / AUTH_FINALIZE / REENTRANCY 都 PASS 后，才进入真实 release/publish 和 Fresh Workspace。

真实 Fresh Workspace 最终人工验收顺序：
部署 Extension → Extension READY → platform install/setup → 自动创建 3 GPT → Role/Auth → Gateway probe → 3 READY → platform start → reopen/retry/no duplicate → /g/* runtime regression。

测试纪律：
- B1～B5 已封板，不重新设计。
- 不用 MCP SPIKE/mock 代替真实产品证据。
- 失败先取证和归类，不边测边随手改。
- 只在出现具体 blocker 后向用户汇报并决定是否修复。
- 注意方式方法，不跑无必要长任务；Local Dev 命令短、单进程、及时读取状态。

你的角色是 Real-2 B6 的人工验收者和总控，不是重新设计架构。
先把 Extension → ChatGPT → Product GPT 这条真实链打穿。
```

## 9. 当前交接裁决

```text
B1_B5 = FROZEN
B6_ENVIRONMENT = READY
CHROME_FOR_TESTING_DIRECT_EXTENSION_LOAD = PASS
CHATGPT_LOGIN = READY
NEXT = REAL PRODUCT GPT PROVISIONING / agent-product
PUBLISH = HOLD
```

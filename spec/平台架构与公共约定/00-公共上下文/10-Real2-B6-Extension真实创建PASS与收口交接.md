# Real-2 B6｜Extension 真实创建 PASS 与收口交接

更新时间：2026-08-24 15:27 +08:00
仓库：`/Users/agent/Desktop/proton-workspace/repos/proflow`
工作区：`/Users/agent/Desktop/proton-workspace`
阶段：`REAL_2 / B6`

## 1. 本 Chat 最重要结论

本 Chat 已经用真实 Chrome for Testing + 真实 ProFlow Extension + 真实 ChatGPT GPT Editor，完成并证明了以下主链：

```text
唯一 Provisioning Host
→ 真实 ProFlow Extension
→ Extension 自己打开全新 /gpts/editor
→ 自动填写 Agent Package 配置
→ 上传 Knowledge
→ 安装 Action Schema
→ 选择推荐模型/Capabilities
→ Private Create
→ ChatGPT 显示“GPT 已发布！”/“设置已保存”
→ Extension 返回真实 g-id
→ Host 返回 RESULT=LIVE_CREATED
```

这是 B6 到目前为止第一条排除旧 host、端口污染和残留 command 后的无歧义成功证据。

## 2. 最终成功证据

最终干净轮次前，已先用 ProFlow 自身 provisioning host 做端口独占验证：

```text
BIND_58838_OK
```

随后只启动一个新的 provisioning host，Extension 创建出的唯一新 GPT：

```text
gptId = g-6a8be61996f481918c2d91e0ee369cb9
```

Chrome MCP 截图/页面结构同时确认：

- `GPT 已发布！`
- `设置已保存`
- live URL：`https://chatgpt.com/g/g-6a8be61996f481918c2d91e0ee369cb9-yun-ying-chan-pin-jing-li`
- Knowledge：`proflow-knowledge-smoke.md`
- Action 指向真实 dev tunnel：`ng33g6tf-41705.eun1.devtunnels.ms`
- 推荐模型：`GPT-5.6 Sol (gpt-5-6)`
- Capabilities 与 agent-product 真源一致

Host 最终返回：

```text
RESULT={
  "status":"LIVE_CREATED",
  "gptId":"g-6a8be61996f481918c2d91e0ee369cb9",
  "carrierUrl":"https://chatgpt.com/g/g-6a8be61996f481918c2d91e0ee369cb9",
  "packageName":"@tomflow/proflow-agent-product",
  "version":"0.1.13"
}
```

页面 g-id 与 Host g-id 完全一致。

因此可以正式记录：

```text
EXTENSION_TO_CHATGPT_PRODUCT_SEAM = PASS
PRIVATE_GPT_CREATED = YES
LIVE_G_ID_PRESENT = YES
HOST_FINAL_RESULT = LIVE_CREATED
KNOWN_DUPLICATE_CREATED_IN_FINAL_CLEAN_RUN = 0
```

## 3. 本 Chat 发现并验证过的真实兼容问题

本轮不要把以下问题重新当成猜测；它们均来自真实 Chrome/ChatGPT/Extension 行为：

1. Chrome Extension 对 provisioning command GET 可能不带 Origin；严格 Origin 校验导致 401。
2. provisioning content script 不能以 ESM 静态 import 形式作为普通 manifest content script 运行，必须打成 classic/IIFE bundle。
3. 当前 ChatGPT GPT Editor 默认进入“创建”页，Provisioning 必须显式切到“配置”。
4. Name/Description 当前 UI 的 label 不一定有 `for`，需要 placeholder/局部 scope 语义定位。
5. Knowledge 上传必须精确定位 Knowledge 区域，避免命中头像等其他 file input。
6. Knowledge relay 由 content script 直接 fetch 本地 relay 不稳定，当前成功路径通过 background relay 读取并回传 bytes。
7. 当前 Action Editor 需要适配中文 `架构` / OpenAPI textarea，并在写入后正确返回配置页。
8. 当前推荐模型是真实 `<select>`；`GPT-5.6 Sol (gpt-5-6)` 的 option value 是 `gpt-5-6`。
9. 模型 options 存在异步加载窗口；最终修正为优先按 option.value 匹配，并扩大等待窗口。
10. Content script 返回业务错误时，background 不能把整个 provisioning command 反复重放；只应对 surface-not-ready/连接尚未建立做有限重试。
11. 新建入口是精确 `/gpts/editor`，manifest 不能只匹配 `/gpts/editor/*`。
12. Create 弹窗的 Save 可能短暂 disabled；应等待可点击，而不是立即判失败。

## 4. 测试过程中确认的“非产品故障”

以下问题曾制造大量假阴性/噪音，下个 Chat 不要重复踩坑：

- 曾把 `commandTimeoutMs` 人为压到 15 秒，导致页面最终创建成功但 Host 先报 timeout；正式默认是 180 秒。
- MCP/Local Dev 调用必须短返回；业务进程可以后台等待 180 秒，但不能让 MCP 单次等待 60/90/120/180 秒。
- 曾有 `launchctl submit` 的临时 B6 Job 脱离 Local Dev session 存活，反复拉起 `/tmp/proflow-b6-provision-once.mjs`，造成 58838 端口污染和重复 in-flight command。
- 最终已通过 ProFlow host 实际 bind 得到 `BIND_58838_OK`，再启动唯一 host，才取得干净 PASS。
- Extension Reload 会让旧页面已注入 content script 报 `Extension context invalidated`；这是 Reload 后的历史错误，不应误判为当前 provisioning blocker。
- `[PROFLOW_STAGE] ...` 曾通过 `console.error` 输出，因此 Chrome 扩展错误页会把阶段日志当“错误条目”展示；它们不是产品异常。
- Playwright/Chrome MCP 曾因 tab/focus 漂移造成错误判断；截图必须优先于 tabs current 标记，并对准同一个 GPT Editor。

固定观测方法：

```text
Extension 执行动作
→ Chrome MCP 立即截图（优先局部截图）
→ 先按截图判断真实 UI PASS/FAIL
→ 再用 snapshot/DOM/console/network 定位原因
```

Playwright/Chrome MCP 只能观察，绝不能代替 Extension 填 GPT Editor。

## 5. 当前工作树与正式修复候选

成功后检查到 6 个 tracked 修改：

```text
M packages/execution-browser-extension/extension/background.ts
M packages/execution-browser-extension/extension/provisioning-content.ts
M packages/execution-browser-extension/manifest.json
M packages/execution-browser-extension/src/provisioning-bridge.ts
M packages/execution-browser-extension/tests/custom-gpt-provisioning-transport.test.ts
M scripts/build-packages.mjs
```

另有原 B6 交接文档未跟踪：

`spec/平台架构与公共约定/00-公共上下文/09-Real2-B6-Extension实测计划与新Chat交接.md`

当前审计结论：上述 6 个 tracked 修改**不能盲目恢复**，它们大部分/全部已被真实成功链证明属于正式产品修复候选。

其中已明确需要保留的方向包括：

- background：仅对 surface-not-ready/连接未建立重试，业务错误不整套重放；Knowledge relay background fetch。
- provisioning-content：Configure、字段/Starter/Knowledge/Action/Create 适配、模型 select/value 匹配、Capabilities readback。
- manifest：同时匹配精确 `/gpts/editor` 与 `/gpts/editor/*`。
- provisioning-bridge：真实 Chrome originless command GET 兼容；Knowledge relay Origin 兼容。
- build-packages：provisioning content script 以 esbuild IIFE/classic script 输出。
- transport test：固化 originless GET、one-time relay、IIFE、模型 selector 等回归约束。

## 6. 尚未完成的收口项

当前 Chat 在结束前刚开始检查测试 instrumentation 是否只残留在 deployment 产物；该检查尚未完成，下一 Chat 必须继续，而不是直接跑新 GPT。

需要明确检查并移除/正式化：

- `PROFLOW_STAGE`
- `PROFLOW_B6`
- `KEEPALIVE`
- 为截图观测增加的固定 sleep/阶段日志
- deployment 目录里可能仍存在的临时调试 bundle

规则：

1. 先搜正式 source；正式 source 中若没有测试 instrumentation，不要为了“清理”破坏已经验证成功的正式兼容修复。
2. 再搜 workspace deployment：`/Users/agent/Desktop/proton-workspace/.proflow/deployment/browser-extension/execution-browser-extension`。
3. 测试 instrumentation 可以从 deployment 清掉；正式功能修复必须回到 source + build 产物体系。
4. 不允许直接用旧 `/tmp` backup 覆盖当前 6 个正式修复候选文件。
5. 不允许把最终成功 GPT 当作需要继续编辑的测试基线；后续若再次创建测试 GPT，由用户自行删除。

当前已知调试 SHA（仅用于辨识，不代表目标最终值）：

```text
source provisioning-content.ts = 60a94fa65d7700a172a5f957da8047be3c758daf93311076570f09f54bbd776e
dist provisioning-bridge.js    = f4fae4b00179425ab1799ffaf5df13a0aeb65cd2d43bbf5fd17d9cc0414c06b5
deployment provisioning-content.js = 791caa7a3d4802e18f0230818564242fca1973dc58ea6b676cc2ab11c098ae82
```

## 7. 当前阶段裁决

本 Chat 只把“Extension 真实创建 Custom GPT 并把 g-id 回给 Host”这条最关键 seam 判 PASS。

当前全局仍然是：

```text
ARCHITECTURE = FROZEN
REAL_1 = PASS
CURRENT_STAGE = REAL_2 / B6
EXTENSION_TO_CHATGPT_PRODUCT_SEAM = PASS
REAL2_PROVISIONING_GO = NO
PHASE3_FINAL_GO = NO
PUBLISH = HOLD
```

原因：后续仍需按既定顺序完成：

```text
当前 6 文件正式化/清理/回归
→ Role / Auth / Gateway
→ reentrancy / no duplicate
→ 再决定 Registry publish + Fresh Workspace
```

不要因为主 seam PASS 就直接 publish。
不要重构 B1-B5，不要改 Frozen 架构，不要扩大到其它领域。

## 8. 当前浏览器/Extension 环境

测试浏览器：Chrome for Testing `152.0.7977.54 mac-x64`。
Profile：`/Users/agent/.proflow/browser-test/real2-profile`。
CDP：`127.0.0.1:9229`。

当前 workspace deployment Extension：

`/Users/agent/Desktop/proton-workspace/.proflow/deployment/browser-extension/execution-browser-extension`

真实 Extension ID：

`eehdadpmjffomabiedcjijiakconalab`

Chrome MCP 已通过 Playwright MCP CDP 方式连接同一只 CFT；后续继续坚持：

- Extension 是 actor。
- Chrome MCP / CDP 是 observer。
- 禁止用 MCP 代替 Extension 填写/点击 GPT Editor 产品配置。
- 截图是第一手黑盒证据，DOM/console 只做交叉定位。

测试 GPT 清理由用户自己处理；Assistant 后续不要主动删除测试 GPT。
绝不读取/打印 token、Bearer、Role credential。

## 9. 下个 Chat 直接接管提示词

将下面内容作为新 Chat 的开场提示词：

```text
接管 ProFlow Phase 3 / Real-2 / B6。

仓库：/Users/agent/Desktop/proton-workspace/repos/proflow
工作区：/Users/agent/Desktop/proton-workspace

第一动作必须只读：
完整读取 spec/平台架构与公共约定/00-公共上下文/，尤其：
- 09-Real2-B6-Extension实测计划与新Chat交接.md
- 10-Real2-B6-Extension真实创建PASS与收口交接.md

当前最重要事实：
真实 ProFlow Extension → 真实 ChatGPT → agent-product Private Custom GPT → 真实 g-id → Host RESULT=LIVE_CREATED 已经在排除 58838/旧 host 干扰后的唯一干净轮次 PASS。
最终证据 g-id：g-6a8be61996f481918c2d91e0ee369cb9。
不要重新证明“能不能创建 GPT”，不要再无意义批量创建测试 GPT。

当前首先要做的是成功后的正式收口：
1. 完成 source 与 workspace deployment 中测试 instrumentation 的精确检查；
2. 区分并清除 PROFLOW_STAGE / PROFLOW_B6 / KEEPALIVE / 固定截图 sleep 等测试噪音；
3. 不得盲目恢复当前 6 个 tracked 修改，它们已被真实成功链证明为正式产品修复候选；
4. 对 6 个文件做最终最小化审计，确保只留下产品必要修复；
5. 再按仓库固定规则做 formatter / changed-files Biome safe-fix / targeted test；不要一上来跑长全量 gate。
```

```text
测试纪律继续冻结：
- 不要触发长 MCP 任务；start <= 1~3 秒返回 PID/session，后续短轮询。
- Provisioning 业务自身可使用正式 180 秒 timeout，但 MCP 不得同步等待 180 秒。
- Extension 是 actor；Playwright/Chrome MCP 只能 observer。
- 每次 Extension 产品动作后优先截图，再用 DOM/console 交叉定位。
- 不读、不打印 token/Bearer/Role credential。
- 测试 GPT 删除由用户自己处理，Assistant 不主动删除。
- 不修改 Frozen B1-B5，不重构架构，不扩散到其它 Phase 3 领域。

正式收口完成后，继续原计划而不是发布：
→ Role / Auth / Gateway 真实验证
→ reentrancy / no duplicate
→ 只有这些通过后再评估 Registry publish + Fresh Workspace

当前裁决：
EXTENSION_TO_CHATGPT_PRODUCT_SEAM = PASS
REAL2_PROVISIONING_GO = NO
PUBLISH = HOLD
PHASE3_FINAL_GO = NO

请先汇报你读到的当前状态与第一步收口计划，然后直接执行；不要重新设计，不要重复跑已经 PASS 的主创建链。
```

## 10. 交接特别提醒

最终成功 GPT 是真实产品路径证据，不应因测试清理而被误删；如果用户要删，由用户自己处理。
当前 6 个 tracked 修改是成功后待正式化的修复候选，下一 Chat 的首要风险是“清理时误恢复掉真正修复”。

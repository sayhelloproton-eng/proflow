# Real-2 B6｜公共角色创建 API、同角色覆盖语义与新 Chat 交接

> **HISTORICAL / SUPERSEDED**：本文保留公共 API 与覆盖语义形成过程。真实 3× 覆盖、Auth-before-Create、事务 rollback、ZIP Knowledge、三角色最终验收均已在后续完成；当前状态以 `13-Real2-最终冻结与Real3交接.md` 为准。

更新时间：2026-08-24
仓库：`/Users/agent/Desktop/proton-workspace/repos/proflow`
主工作区：`/Users/agent/Desktop/proton-workspace`
临时真实测试工作区：`/Users/agent/Desktop/proton-workspace/.real2-create-workspace-smoke`
阶段：`REAL_2 / B6`

## 1. 本 Chat 当前终点

本 Chat 已完成两件此前尚未闭环的事情：

1. 把“创建真实 Custom GPT Role”从 `agent-product` 私有实现抽成可复用公共 API：`createCustomGptRole(...)`。
2. 按用户最新明确要求，实现“同一个 `agentPackageRef` 再次成功创建时，workspace 当前 Role 配置覆盖为最新 g-id / carrierUrl”，而不是继续拒绝重复注册。

当前代码层 targeted tests 已通过；**下一步唯一核心任务是做真实 Chrome 黑盒：不清 workspace，连续创建同一个 Product Role，证明 `roles.json` 每次覆盖到最新 g-id。**

当前不要重新做 API 设计，也不要重新证明 Extension 能否创建 GPT。

## 2. 当前实现基线

交接文档生成前实现 HEAD：

```text
1aaeba4 build: resolve reusable Custom GPT role API
7cc5f91 feat(real2): replace current role on successful redeploy
4c0423e refactor(real2): route Product role creation through public API
3b74c3e feat(real2): expose reusable Custom GPT role creation API
```

相关较早收口提交还包括：

```text
c19201a test(real2): stop pinning GPT provisioning internals
e5d6c9b refactor(real2): require explicit GPT save confirmation
95e723d refactor(real2): tighten private GPT visibility
351861d refactor(real2): remove dead GPT finalize protocol
96e703b refactor(real2): remove cross-tab GPT create fallback
```

交接时工作树在新增本文档前为 CLEAN。新 Chat 第一动作仍要机械执行 `git status --short` 和 `git log -8 --oneline`，不要只相信本摘要。

## 3. 公共创建 API 已经在哪里

公共 API 文件：

`packages/execution-browser-extension/src/custom-gpt-role.ts`

公开函数：

```ts
createCustomGptRole(input, ports)
```

它负责：创建正式 provisioning host → Extension 创建 GPT → 严格校验 `LIVE_CREATED` → 关闭 host → 调用 Role Registry Port 持久化 → 再 inspect/readback，必须精确匹配新 g-id 与 carrierUrl 后才返回成功。

公共 package export 已加入：

```text
@tomflow/proflow-execution-browser-extension/custom-gpt-role
```

设计边界已经确定：Execution/Extension package 不直接依赖 Agent Runtime；workspace Role 持久化通过 `CustomGptRoleRegistryPort` 注入，避免反向依赖。

## 4. Product 已经改走公共 API

`packages/agent-product/deployment/adapter.ts` 已删除原私有 provisioner 依赖，MISSING Role 分支走：

```text
agent-product Module.setup
→ createWorkspaceRoleSetupClient(workspaceRoot)
→ createCustomGptRole(...)
→ roleClient.saveCurrentRole(...)
→ inspectRole(...)
```

原私有文件：

`packages/agent-product/src/custom-gpt-deployment-provisioner.ts`

已经删除，不要恢复。

注意：**当前 `Module.setup` 在 Role 已是 READY 时会直接返回现有 Role，不会再次创建 GPT。**

因此下一步“同角色连续创建三次”的黑盒不能机械重复调用 `agent-product Module.setup`，否则第二次开始会被 READY short-circuit。真实覆盖测试应直接调用已经公开的 `createCustomGptRole(...)`，并把 workspace `roleClient.saveCurrentRole` 作为 port 注入。

## 5. 同角色覆盖语义

Agent Runtime 新增部署专用 API：

```ts
saveCurrentRole(raw)
```

语义：普通 `registerRole()` 仍保留“一 package 一当前 Role / 重复拒绝”合同；只有部署成功后用于保存“当前 Role”的 `saveCurrentRole()` 才允许同一个 `agentPackageRef` 替换旧当前 Role。

目标行为：

```text
Product / g-old
→ create new GPT = g-new
→ saveCurrentRole(Product, g-new)
→ roles.json 只保留 Product 当前 g-new
→ Product credential 同步替换
→ 其它 Agent Package Role 不变
```

实现文件：

- `packages/agent-runtime/src/index.ts`
- `packages/agent-runtime/src/role-management-client.ts`
- `packages/agent-runtime/tests/agent-runtime-critical-proofs.test.ts`

对应关键证明：

```text
CP-AGT-RUNTIME-01A deployment save replaces only the package current role = PASS
```

## 6. 已通过的代码测试

本 Chat 最后确认：

```text
agent-runtime: 25 tests / 25 pass / 0 fail
agent-product: 12 tests / 12 pass / 0 fail
```

公共 `createCustomGptRole` targeted tests此前已通过，包括成功精确持久化 LIVE_CREATED、失败不落盘；Extension typecheck / Product typecheck 在公共化收口阶段也已通过。

## 7. 当前真实测试 workspace 状态

交接前机械读取：

`/Users/agent/Desktop/proton-workspace/.real2-create-workspace-smoke/.proflow/agent/roles.json`

当前只有一个 Product Role：

```text
agentPackageRef = @tomflow/proflow-agent-product
registeredPackageVersion = 0.1.13
roleRef = g-6a8c3e7934bc8191b5bb51529bbfac05
carrierUrl = https://chatgpt.com/g/g-6a8c3e7934bc8191b5bb51529bbfac05
```

**下一轮不要清掉它。**它正好可以作为“已有当前 Role”的真实起点。

注意：这里只能把该文件内容当作当前 workspace reality。不要仅凭这个 g-id 推断它已经完成了本轮“公共 API 连续覆盖三次”验收；本 Chat 尚未形成那组连续 3 次 + 每次 roles.json readback 的完整黑盒证据。

## 8. 下一步真实黑盒唯一目标

使用同一个临时 workspace，不删除 roles，不删除 staging，不手写 `roles.json`，连续调用公共 API 创建同一个 Product Role 3 次。

预期：

```text
baseline = 当前 g-6a8c3e7934bc8191b5bb51529bbfac05
RUN-1 → g-A → roles.json Product = g-A
RUN-2 → g-B → roles.json Product = g-B
RUN-3 → g-C → roles.json Product = g-C
```

每一次都必须同时确认：

- Extension/Host 返回 `LIVE_CREATED`；
- 返回 g-id 是该轮真实新 g-id；
- `roles.json` 的 Product `roleRef` 与本轮 g-id 精确相等；
- `carrierUrl === https://chatgpt.com/g/<本轮 g-id>`；
- Product 当前 Role 数始终为 1；
- 第 2/3 次成功后旧 g-id 不再是 workspace 当前绑定；
- 不影响其它 Agent Package（该 smoke workspace 当前本来只有 Product）。

最终裁决目标：

```text
CREATE_1 = PASS
CREATE_2 = PASS
CREATE_3 = PASS
LATEST_ROLE_OVERWRITE = PASS
LATEST_CARRIER_URL = PASS
OLD_ROLE_NOT_CURRENT = PASS
PRODUCT_CURRENT_ROLE_COUNT = 1
```

## 9. 真实测试调用方式

不要为了测试修改 Product Module.setup 的 READY short-circuit。

建议用临时 runner（放 `/tmp`，不要加入产品代码）直接 import 已 build 的公共入口或明确的 dist 文件：

```text
createCustomGptRole(...)
+ createWorkspaceRoleSetupClient(smokeWorkspace)
+ saveRole: input => roleClient.saveCurrentRole(input)
+ inspectRole: input => roleClient.inspectRole(input)
```

Product material 必须来自 `agent-product` 正式 package 真源/`materializeAgentPackage`，不要手造弱化 fixture。Gateway URL 重新从 workspace shared facts 读取，不要仅复制历史 URL。

公共 API 默认自己创建并关闭 provisioning host；连续三轮可以顺序调用三次，不需要共享 host 才能证明覆盖语义。

正式 provisioning 自身可等待长窗口，但 Local Dev/MCP 调用继续短返回 PID/session，再短轮询；禁止单次 MCP 等 60/90/120/180 秒。

## 10. Browser / Extension 纪律继续冻结

测试浏览器：Chrome for Testing `152.0.7977.54`。
Profile：`/Users/agent/.proflow/browser-test/real2-profile`。
CDP：`127.0.0.1:9229`。
Extension ID：`eehdadpmjffomabiedcjijiakconalab`。
Workspace deployment：`/Users/agent/Desktop/proton-workspace/.proflow/deployment/browser-extension/execution-browser-extension`。

固定角色：

```text
Extension = actor
Playwright/Chrome MCP = observer
```

每次 Extension 发起真实产品动作后，优先立刻截图确认真实 UI，再用 DOM/snapshot/console 定位。禁止用 MCP 代替 Extension 填充或点击 GPT Editor。

测试 GPT 删除继续由用户自己处理；Assistant 不主动删除。
绝不读取/打印 provisioning token、Bearer、Role credential。

## 11. 重要边界：Frozen 文档存在旧语义

现有冻结规范曾写过“v1 没有 role update / replace；更换时删除旧注册再重新注册”。用户在本 Chat 后续明确修正真实产品要求：**同一个角色创建多次，workspace 配置应该覆盖到最新创建结果。**

当前实现采用最小兼容方式：普通 `registerRole()` 合同不变，只新增部署语义 `saveCurrentRole()`。下一 Chat **不要为了这个冲突把代码回退，也不要在真实黑盒前扩成架构重构**。

若真实连续覆盖 PASS，后续正式收口时再按治理规则记录/修正文档合同冲突；不得静默把 Frozen Spec 当普通 README 随手改掉。

## 12. 当前阶段裁决

```text
ARCHITECTURE = FROZEN
REAL_1 = PASS
CURRENT_STAGE = REAL_2 / B6
EXTENSION_TO_CHATGPT_PRODUCT_SEAM = PASS
PUBLIC_CUSTOM_GPT_ROLE_API = IMPLEMENTED
SAME_PACKAGE_CURRENT_ROLE_REPLACE_UNIT = PASS
REAL_SAME_ROLE_3X_OVERWRITE = NOT_YET_PROVEN
PUBLISH = HOLD
PHASE3_FINAL_GO = NO
```

下一步不 publish，不扩展到 Controller-Dev / Test-Ops，不进入 Real-3。

## 13. 下一个 Chat 直接使用的开场提示词

```text
接管 ProFlow Phase 3 / Real-2 / B6，继续当前公共 Custom GPT Role API 的真实覆盖验收。

仓库：/Users/agent/Desktop/proton-workspace/repos/proflow
主工作区：/Users/agent/Desktop/proton-workspace
真实临时测试工作区：/Users/agent/Desktop/proton-workspace/.real2-create-workspace-smoke

第一动作只读：完整读取
spec/平台架构与公共约定/00-公共上下文/
尤其是：
- 10-Real2-B6-Extension真实创建PASS与收口交接.md
- 11-Real2-B6-公共角色创建API与覆盖语义-新Chat交接.md
```

```text
随后机械确认：
- git status --short
- git log -8 --oneline
- 当前 smoke roles.json
- provisioning 58838 是否无残留 listener
- Chrome for Testing / Extension 是否仍可观测

当前代码事实：
- 公共 API：packages/execution-browser-extension/src/custom-gpt-role.ts 的 createCustomGptRole(...)
- Product 已走公共 API；原私有 custom-gpt-deployment-provisioner.ts 已删除
- Agent Runtime 新增 saveCurrentRole(...)，用于同 agentPackageRef 成功重部署后的当前 Role 覆盖
- 普通 registerRole() 重复拒绝语义仍保留
- agent-runtime 25/25 PASS
- agent-product 12/12 PASS

当前 smoke workspace 已有 Product Role，不要清理；交接时 roleRef 是：
g-6a8c3e7934bc8191b5bb51529bbfac05

本轮唯一目标：不清 workspace、不手改 roles.json，直接通过公共 createCustomGptRole API 连续创建同一个 Product Role 3 次。每次成功后立即读取 roles.json，证明它覆盖成该轮最新 g-id；最终 Product 当前 Role 数必须仍为 1。

注意：不要重复调用 Product Module.setup 来做 3 次测试，因为 Role READY 时 Module.setup 会 short-circuit 返回旧 Role；连续覆盖测试必须直接调用公共 API，并注入 createWorkspaceRoleSetupClient(...).saveCurrentRole/inspectRole。
```

```text
真实测试纪律：
- Extension 是 actor；Playwright/Chrome MCP 只做 observer。
- 每轮 Extension 动作后优先截图，再做 DOM/console 交叉定位。
- Local Dev 长业务用后台 PID + 短轮询，禁止长同步 MCP 调用。
- 不读、不打印任何 token/Bearer/Role credential。
- 测试 GPT 由用户自己删除，Assistant 不主动删除。
- 不 publish，不改版本，不进入 Real-3。
- 不扩展到 Controller-Dev/Test-Ops，先把 Product 公共 API 的真实覆盖语义闭环。

最终必须拿到：
CREATE_1=PASS
CREATE_2=PASS
CREATE_3=PASS
LATEST_ROLE_OVERWRITE=PASS
LATEST_CARRIER_URL=PASS
OLD_ROLE_NOT_CURRENT=PASS
PRODUCT_CURRENT_ROLE_COUNT=1

如果其中任一失败，先保留现场并定位，不要清 workspace 重来掩盖失败。
如果全部 PASS，再做最小代码/文档一致性收口；现有 Frozen Spec 关于“无 role update/replace”的旧句子与当前用户要求存在冲突，必须按正式治理处理，不要在测试前回退实现或扩成架构重构。

先向用户汇报你读到的当前状态，然后直接继续真实覆盖测试，不要重新设计。
```

## 14. 交接结论

当前不是“还在开发创建 GPT”。创建链已经稳定；公共化和同 package 覆盖的代码层也已经 PASS。

下一个 Chat 要证明的只剩最后一条真实事实：**公共 `createCustomGptRole` 在已有 Role 的真实 workspace 中连续成功运行时，Role Registry 是否始终覆盖成最新创建的真实 GPT。**

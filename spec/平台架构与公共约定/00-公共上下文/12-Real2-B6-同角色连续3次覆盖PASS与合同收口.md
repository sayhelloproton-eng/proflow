# Real-2 B6｜同角色连续 3 次真实覆盖 PASS 与合同收口

> **HISTORICAL / SUPERSEDED**：本文保留同 package 3× 覆盖的真实证据。后续又完成 Auth-before-Create、activation rollback、ZIP Knowledge、三角色最终配置与 Real-2 全量收口；当前阶段状态与最终合同以 `13-Real2-最终冻结与Real3交接.md` 为准。

更新时间：2026-08-24
仓库：`/Users/agent/Desktop/proton-workspace/repos/proflow`
临时真实测试工作区：`/Users/agent/Desktop/proton-workspace/.real2-create-workspace-smoke`
阶段：`REAL_2 / B6`

## 1. 本轮结论

`createCustomGptRole(...)` 已在**不清 workspace、不手改 Role Registry**的前提下，对同一个 Product Agent Package 连续真实创建 3 次 Custom GPT，并在每次 `LIVE_CREATED` 后把 workspace 当前 Role 覆盖到本轮最新 g-id。

最终裁决：

```text
CREATE_1 = PASS
CREATE_2 = PASS
CREATE_3 = PASS
LATEST_ROLE_OVERWRITE = PASS
LATEST_CARRIER_URL = PASS
OLD_ROLE_NOT_CURRENT = PASS
PRODUCT_CURRENT_ROLE_COUNT = 1
```

这条证据补齐了 `11-Real2-B6-公共角色创建API与覆盖语义-新Chat交接.md` 中的 `REAL_SAME_ROLE_3X_OVERWRITE = NOT_YET_PROVEN`。
## 2. 真实连续覆盖证据

测试前 baseline：

```text
g-6a8c3e7934bc8191b5bb51529bbfac05
```

连续三轮结果：

```text
RUN-1 = g-6a8c4961975481919ecf84c7ad43a55a
RUN-2 = g-6a8c49b3e46881918790af8f92f79a84
RUN-3 = g-6a8c4a2ffbc88191840b1ef41f5effbe
```

每轮 runner 都由正式公共入口 `createCustomGptRole(...)` 调用真实 provisioning host，并注入 `createWorkspaceRoleSetupClient(...).saveCurrentRole/inspectRole`；Product material 来自正式 `agent-product` package manifest，Gateway URL 来自 workspace shared facts。

每轮 Extension 自己打开新的 `https://chatgpt.com/gpts/editor`，Playwright Chrome MCP 只做 observer / screenshot；没有用 MCP 代替 Extension 填写或点击 GPT Editor。

三轮 Host 均返回 `LIVE_CREATED`，且每轮 `persistedRoleRef === gptId`、`persistedCarrierUrl === https://chatgpt.com/g/<gptId>`、`productRoleCount === 1`。
## 3. 最终 workspace reality

最终 `roles.json` 的 Product 当前 Role：

```text
agentPackageRef = @tomflow/proflow-agent-product
registeredPackageVersion = 0.1.13
roleRef = g-6a8c4a2ffbc88191840b1ef41f5effbe
carrierUrl = https://chatgpt.com/g/g-6a8c4a2ffbc88191840b1ef41f5effbe
```

baseline、RUN-1、RUN-2 的三个旧 g-id 均已机械确认 `NOT_CURRENT`。最终 Product 当前 Role 数为 1；58838 无残留 listener；测试结束后仓库 working tree 在文档收口前仍为 CLEAN。

## 4. 合同冲突正式收口

旧 Frozen 文档把“v1 没有 role update / replace”写成了“更换时必须 delete old registration + register new role”。本轮按用户明确产品要求和真实 3× evidence 做最小合同澄清：

- v1 仍不提供通用 runtime `updateRole/replaceRole` API；
- 普通 `registerRole()` 的同 package 重复拒绝合同不变；
- 新 GPT 已真实 `LIVE_CREATED` 后，Deployment 可使用 Agent owner 的 `saveCurrentRole()` 原子替换同 package 当前 Role/credential；
- 其他 Agent Package Role 不得被覆盖；
- 该能力不是 active Task Role migration；普通 setup retry / package upgrade 仍优先复用现有 Role；
- ProFlow 不负责删除 ChatGPT 中旧 GPT，测试 GPT 仍由用户自行处理。
## 5. 当前阶段状态

```text
ARCHITECTURE = FROZEN
REAL_1 = PASS
CURRENT_STAGE = REAL_2 / B6
EXTENSION_TO_CHATGPT_PRODUCT_SEAM = PASS
PUBLIC_CUSTOM_GPT_ROLE_API = PASS
REAL_SAME_ROLE_3X_OVERWRITE = PASS
PUBLISH = HOLD
REAL2_PROVISIONING_GO = NO
PHASE3_FINAL_GO = NO
```

`REAL2_PROVISIONING_GO` 仍不能因为本条 PASS 提前打开。Real-2 Test Plan 还要求 Role/Auth/Gateway、setup reentrancy/no-duplicate、三个真实 Agent Role、Fresh Workspace reopen 等剩余 evidence。

下一步继续 Real-2，不进入 Real-3，不 publish：按 `REAL2-Custom-GPT-Deployment-Provisioning.md` 从尚未真实闭环的 Critical Proof / Required Failure Boundary 中选择最短真实路径继续。

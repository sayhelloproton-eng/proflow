# Real-2｜最终冻结、收口审计与 Real-3 交接

更新时间：2026-08-25
仓库：`/Users/agent/Desktop/proton-workspace/repos/proflow`
工作区：`/Users/agent/Desktop/proton-workspace`

## 1. 最终裁决

```text
ARCHITECTURE = FROZEN
REAL_1 = PASS
REAL_2 = PASS
REAL2_PROVISIONING_GO = YES
READY_FOR_REAL_3 = YES
CURRENT_STAGE = REAL_3
PHASE3_FINAL_GO = NO
```

Real-2 已完成最终 Narrow Audit。代码、测试计划、模块公开文档与真实 Chrome/ChatGPT evidence 已对齐；除新的可复现 regression evidence 外，不允许重新打开 Real-2。

Real-1 已独立承担 Deployment / Registry / Fresh Workspace 安装验收；Real-2 最终只冻结真实 Custom GPT / Worker Identity 能力，不重复 Real-1 职责。

## 2. 冻结 Golden Path

```text
workspace + agentPackageRef = 稳定逻辑 Role identity
→ Agent Runtime prepareRoleCredential（仅内存，不落盘）
→ createCustomGptRole / 单 workspace 串行队列
→ 一个 GPT Editor tab
→ fields / starters / model / 3 capabilities
→ Action Schema
→ API Key + Bearer + candidate credential
→ Knowledge ZIP 本体
→ FORM_READY readback
→ Private Create
→ LIVE_CREATED g-id / carrierUrl
→ saveCurrentRole(g-id, candidate credential)
→ durable readback
→ Gateway authenticated probe
→ READY
```
## 3. Role / overwrite / rollback 冻结语义

- logical identity：`workspace scope + agentPackageRef`。
- `roleRef` 是当前 Custom GPT g-id，是可替换 carrier identity，不是稳定 logicalRoleId。
- 同 package 显式调用 `createCustomGptRole`：每次创建全新 GPT、新 g-id、新 credential；`saveCurrentRole` 只覆盖该 package 当前 binding。
- `Module.setup` 的 `READY` 分支直接复用 current Role，不因普通 setup retry 重复创建。
- `DRIFT` 不自动 Edit 旧 GPT；返回显式处理，不恢复旧 Edit happy path。
- 普通 `registerRole` 同 package 重复拒绝合同不变。
- activation/Gateway verification 在 current Role 保存后失败时，使用一次性 rollback 恢复替换前 Role + credential；首次创建失败保持 MISSING。
- workspace create queue 覆盖完整创建/持久化/验证事务；前序失败被隔离，不毒化后序。

正常 Golden Path 不调用 `FINALIZE_CUSTOM_GPT_AUTH`。该 operation 只保留为 Extension recovery/repair primitive，不得重新成为 post-create 正常步骤。

## 4. 三个最终角色配置

```text
@tomflow/proflow-agent-product
name = 运营 + 产品经理
current g-id = g-6a8c9b42055c819192761c0c88be6f67

@tomflow/proflow-agent-controller-dev
name = 研发 + 项目总控
current g-id = g-6a8c9b9678108191ad1f2e5699429767

@tomflow/proflow-agent-test-ops
name = 部署 + 测试验收
current g-id = g-6a8c9c7661b881919f1da2c6aebccbe0
```

三个 package 均冻结：`webSearch=true`、`imageGeneration=true`、`codeInterpreter=true`、`recommendedModel=gpt-5-6`。
Knowledge 冻结：三个角色最终上传 `knowledge/custom-gpt-knowledge.zip` 本体，MIME=`application/zip`。ZIP 仍在 Mac 侧校验结构、traversal、内部支持类型、单项大小与总大小；不恢复解包后逐 `.md` 上传。

Auth 冻结：Create 前在同一个 Editor 内选择 `API Key` + `Bearer` 并填 candidate credential；输入阶段有 readback gate，保存后重新打开 UI 显示 `[HIDDEN]`，证明 secret 已持久化但不回显原值。不得读取、打印、记录 credential。

## 5. 最终验收证据

```text
agent-product tests = 12/12 PASS
agent-controller-dev tests = 15/15 PASS
agent-test-ops tests = 14/14 PASS
agent-runtime tests = 25/25 PASS
execution-browser-extension tests = 86/86 PASS
相关 typecheck = PASS

真实 Chrome / ChatGPT：
Extension = actor
Playwright Chrome = observer
三个最终角色真实创建 = PASS
Knowledge ZIP 页面 evidence = PASS
3 capabilities checked = PASS
Bearer [HIDDEN] reopen evidence = PASS
ROLE_COUNT = 3
DISTINCT_PACKAGE_COUNT = 3
DISTINCT_GPT_ID_COUNT = 3
同 package 3× explicit recreate overwrite = PASS
queue failure isolation = PASS
activation rollback = PASS
Gateway authenticated probe = PASS
```

关键收口提交包括 `398989e`、`aa069bb`、`d5c4490`、`5ff6c9b`、`fe87695`、`9cae222`、`b67dce5`、`157b0b6`。
## 6. 收口审计裁决

```text
REAL2_CODE_AUDIT = PASS
REAL2_DOC_ALIGNMENT = PASS
REAL2_TEST_ALIGNMENT = PASS
REAL2_REAL_EVIDENCE = PASS
```

审计未发现需要在 Real-2 内继续整改的产品 blocker。保留的 `FINALIZE_CUSTOM_GPT_AUTH`、package-specific material/diagnostic CLI、包级 adapter glue 均有明确 recovery/ownership 边界，不属于冗余 Golden Path。

以下旧路径已正式废弃：人工 setup 01..04、手工复制 Instructions/Schema/Bearer、Edit-existing happy path、Create 后二次 Auth happy path、Knowledge 解包后逐文件上传、旧角色名与 capability optional/false 合同。

## 7. 文档权威关系

当前 Real-2 真源：

1. `spec/智能体运行与协作领域/07-测试计划/REAL2-Custom-GPT-Deployment-Provisioning.md`
2. 本文 `13-Real2-最终冻结与Real3交接.md`
3. 三个 Agent Package 的 `package.json / DOCS.md / SETUP.md`
4. `packages/execution-browser-extension/DOCS.md`

`09 / 10 / 11 / 12` 为过程交接与历史 evidence，已标记 `HISTORICAL / SUPERSEDED`；不得从其中恢复旧阶段状态或旧 Golden Path。

## 8. Real-3 交接

Real-3 固定目标仍是 `J0～J4`。进入 Real-3 前允许做一轮**配置自动化盘点/前置优化**，但不得借此重新打开 Real-2 或改变 Frozen Architecture。

下一步优先回答：当前平台仍有哪些 setup/config 人工动作可以通过已有 CLI、shared facts、浏览器 Extension、runtime discovery 或安全的本机自动化进一步消除；只有真正受浏览器安全边界、第三方登录/授权或用户意图约束的动作才保留人工。
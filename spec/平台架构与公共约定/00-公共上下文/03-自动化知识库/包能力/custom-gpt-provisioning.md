# Runbook｜Custom GPT / Role Provisioning

> Real-2 已 PASS/FROZEN；本 Runbook 只保存真实创建/恢复与 Real-3 J0 所需的稳定操作知识，不重开设计。

## 核心语义

必须区分：

```text
Role = 角色定义 / GPT identity
Worker = 某个 Task 下的工作实例
Role != Worker
```

Real-3 J0 要求 3 个 Role/GPT 已真实 READY；后续 J1 才为 Task 建立 Product/Dev/Test Worker 与 Conversation Binding。

## 用户/自动化路径

Custom GPT 创建和验证必须通过真实已登录 ChatGPT Browser 与 Extension/产品能力完成；不能直接伪造 identity、conversation URL 或 owner state。

历史能力为 create-only/no edit。已有同一 Role identity 时不得为了测试“Fresh 感”盲目再建第二个 GPT；恢复/重放必须先确认当前真实 identity 与 owner facts。

Product Workspace 中的 Role/identity 配置只是本地事实之一。**durable Role authority 是 Agent Owner 的 role management facts（`role.list / role.show / role.validate`）；真实 ChatGPT Browser 是 carrier liveness/identity validation。** 二者交叉一致才判 READY，不能只因某个本地 JSON 缺失就重新 create。

## 自动化原则

- 创建多个 Role 时复用同一稳定 provisioning API/Extension 能力，不重新写三套浏览器流程。
- 真实 Browser 需要登录态；账号授权/CAPTCHA 等不可替代动作由用户完成。
- API 返回成功不能单独证明 GPT 实体可用；至少要有真实 Browser 可访问/owner identity 对齐证据。
- 已真实 READY 的 3 Role 不因其它包修复而重复创建。

## Real-3｜现存 GPT 编辑 / 修复自动化

**产品边界保持不变：平台正式业务逻辑只有创建，不增加“编辑 GPT”产品能力。** 下述路径只属于 Real-3 模拟人工验收、事故修复和外部配置校准；当 Action Schema、Bearer Auth、Capabilities 等需要随真实 Journey 调整时，必须编辑既有 GPT，禁止通过重新 create 获得“新配置”。

优先的安全自动化路径是已有 `FINALIZE_CUSTOM_GPT_AUTH` recovery primitive：机械读取当前 Browser Reality 的 `g-id` → Agent Owner 恢复/确认同一 `roleRef` 与 credential → `createWorkspaceCustomGptProvisioningHost` → `finalizeRoleAuth({ carrierUrl, credential })` → Extension 打开 `/gpts/editor/<g-id>` → 只更新既有 Action Auth → 返回 `AUTH_UPDATED` 且 g-id 必须不变 → `platform setup` 只做 Gateway revalidation → `platform status` 回读。credential 只在 Owner/本地进程/Extension 通道流转，禁止进入 Chat、日志或 validation evidence。

Provisioning host 已监听、token/endpoint 对齐但 `PROVISIONING_EXTENSION_OFFLINE` 时，先判断是不是 Extension service worker 没有运行 provisioning loop；**不要把 Browser READY 误等同 provisioning loop 在线，也不要重装扩展。** 可用当前物化 Extension 自己的 side-panel 页面唤醒 service worker，随后回读 host `online=true + extensionInstanceId`，再继续同一 recovery command。若仍离线，再按 Browser Runbook 查 runtime-config / chrome.storage / heartbeat authority。

需要人工 UI 调整 Action Schema / Capability 等非 Auth 字段时，稳定路径固定为：`/gpts/editor/<现存 g-id>` → `配置` → 找到**现有 Action 行**并进入编辑（禁止“创建新操作”）→ 修改目标字段 → Auth 弹窗如需更新则保持 `API 密钥 + Bearer` → 弹窗 `保存` → 顶部 `更新` → Browser DOM readback `GPT 已更新` → 再回原 Journey checkpoint。每个动作采用 `act → observe → authority readback → next`；普通 click actionability 超时时，可在已精确定位、已授权的同一 DOM 元素上使用等价 Playwright DOM click，不得凭坐标盲点。

任何现存 GPT 编辑前都先确认当前 `g-id` 来自 `https://chatgpt.com/gpts/mine` / 真实 GPT 页面；历史文档里的旧 g-id 只作事故追溯，404 或 identity 漂移时不得继续写入。编辑完成后必须证明 g-id 未变化，并重新验证 Owner Role / Gateway；**编辑成功 != Real-3 PASS**，它只是恢复当前 Journey 的前置事实。

## 冻结的可执行创建路径

当前源码与历史真实验收共同确认的公共链路：

```text
agent package Module.setup
→ createCustomGptRole(...)
→ createWorkspaceCustomGptProvisioningHost(...)
→ 真实 ChatGPT Browser editor driver
→ createPrivate() / LIVE_CREATED
→ saveCurrentRole / durable Role authority
→ inspectRole
→ verifyCarrier
```

`createCustomGptRole` 对同一 Workspace 使用串行 queue，多个 Role 复用同一公共 provisioning 能力。**Custom GPT 浏览器创建路径已 FROZEN / DO NOT TOUCH**：无新的可复现 regression + 用户明确裁决时，不改 selectors、点击顺序、等待策略、create-only 语义、串并行策略，也不临时写第二套浏览器创建脚本。

创建前先按 `基础动作/Tool-Runtime-gptweb-mcp.md` 复用真实 Chrome；普通 Web 操作用 Playwright，不能通过重启 Chrome、重连第二条控制链或修改产品 state 来“准备环境”。

## 不可逆远端资源的恢复

`LIVE_CREATED` 以后远端 GPT 对当前 host 是不可逆资源。稳定安全合同：

```text
LIVE_CREATED
→ durable Role/credential authority 必须保留
→ Carrier live validation 可重试
→ transient validation FAIL 不得把 Role 回滚成 MISSING
→ 下一次 setup 只 revalidate 同一 Role
→ 禁止再次 create 第二个 GPT
```
如果本地 Role 缺失但浏览器/历史 evidence 表明远端 GPT 可能已经创建，**先恢复 remote/local authority，再决定是否 setup**；盲目重跑 setup 可能重复创建不可逆 GPT。

Carrier validation 仍是 READY 必要证据，不能为了避免重复创建而删掉验证。validation/evidence 不得保存 credential；Role/package/carrier/gateway drift 时旧 validation evidence 必须 stale 并重新验证，但仍不因此重建 GPT。

## J0 / 后续流程使用

J0 只确认三个既有 Role/GPT 对真实 Task 可用，不以“Fresh 感”为目的删除或重建。具体 RoleRef/GPT ID 属于当前 owner/runtime 事实，必须机械读取，不写死在长期 Runbook。

Real-3 的 Worker/Conversation 是 Task 运行实例，不复用 Role identity 当 Worker。J1 创建 Worker 时不得回头修改或重建 J0 Role。

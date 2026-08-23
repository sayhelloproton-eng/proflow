---
docId: AGENT-DOC-03-01
title: 智能体运行与协作领域｜Role Registry 与认证
docType: identity-persistence
authority: normative
lifecycle: active
domain: agent-runtime-collaboration
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs: []
---

# 智能体运行与协作领域｜Role Registry 与认证

---

# 1. Role Registry 的目的

Agent Package 发布时不知道工作区部署后真实 Custom GPT 的 `g-id`，因此必须在真实 Web Provisioning 完成后建立本地映射：

```text
Agent Package material
→ Browser Extension Provisioning 创建/更新并确认 live GPT
→ 返回 real g-id / carrierUrl
→ Agent Domain registerRole
→ Role Registry
```

`role register` CLI 是显式本地管理/恢复入口，不是正常 Deployment happy path，也不是 Role 事实 Owner。

Role Registry 是：

> **当前工作区已注册真实 Agent Role 的 Agent Domain 真源。**

即使物理数据在 `.proflow`，其业务 Owner 仍是 Agent Domain。

禁止其他模块通过通用 `readFile` 读取/解释该 Registry 绕过 Agent Public API。

---

# 2. v1 一包一 Role

```text
1 workspace
1 Agent Package
→ max 1 currently registered Role
```

固定三个：

```text
agent-product        → 一个产品 Role
agent-controller-dev → 一个总控+研发 Role
agent-test-ops       → 一个测试+运维 Role
```

不做：

```text
Role Pool
Role alias
multiple active Roles for same Agent Package
automatic failover
update/replace binding
```

需要换 GPT：

```text
owner delete-role
→ Provisioning Driver 创建/确认新的 live GPT
→ Agent Domain registerRole(new g-id)
```

正常部署仍由 owning setup 编排；CLI 只保留显式管理/恢复能力。

---

# 3. RegisteredRole 数据

逻辑字段：

```text
agentPackageRef
registeredPackageVersion
roleRef              # v1 = real Custom GPT g-id
carrierType          # custom-gpt
carrierUrl           # fixed GPT role URL
registeredAt
```

v1 没有 `DELETED` / tombstone 状态。

名称、描述、对话开场白、Instructions 继续来自 Agent Package `package.json`，Role Registry 不复制第二份业务真源。

运行 API 可通过 `agentPackageRef` 投影当前已安装包的：

```text
displayName
description
packageVersion
```

`roleRef` 对 Task/Execution 等其他领域永远是 opaque string；只有 Custom GPT Carrier 适配器理解 g-id 结构。

---

# 4. Runtime Public API 只保留两个

```text
listRegisteredRoles()
getRegisteredRole(roleRef)
```

不暴露：

```text
registerRole
unregisterRole
updateRole
replaceRole
deleteRole
```

Role 创建/删除/凭据管理属于 Agent Domain 本地 management surface，不是 GPT Action Runtime API。Package CLI 是该 management surface 的显式入口之一；Deployment setup 可直接调用 owner capability，不需要绕回 CLI 文本协议。

---

# 5. listRegisteredRoles

该查询服务 **Deployment / Carrier coordination / 管理 UI/CLI / doctor**。2026-08-14 起不再由 Product GPT 在 New Task 主链调用。Extension/platform-host 已知道固定三个 `agentPackageRef`，可通过受控管理/Carrier lookup 解析当前 roleRef。

概念返回：

```json
{
  "roles": [
    {
      "agentPackageRef": "@.../agent-product",
      "registeredPackageVersion": "1.2.3",
      "roleRef": "g-...",
      "carrierType": "custom-gpt",
      "carrierUrl": "https://chatgpt.com/g/g-...",
      "packageInfo": {
        "displayName": "运营 + 产品经理",
        "description": "..."
      }
    }
  ]
}
```

产品逻辑使用稳定 `agentPackageRef` 区分 product/dev/test，不使用用户可编辑 displayName 做业务键。

---

# 6. getRegisteredRole

Execution Runtime Browser Driver / Agent Runtime 需要把 Task 的 opaque `roleRef` 解析为当前 Carrier target 时通过 Agent Public Contract 使用。

概念返回：

```json
{
  "agentPackageRef": "@.../agent-controller-dev",
  "registeredPackageVersion": "1.0.0",
  "roleRef": "g-...",
  "carrierType": "custom-gpt",
  "carrierUrl": "https://chatgpt.com/g/g-...",
  "packageInfo": {
    "displayName": "总控 = 项目管理 + 研发",
    "description": "..."
  }
}
```

Browser Extension 不直接解析 `.proflow` Registry 文件。

---

# 7. Role 注册与 Key 生成

Canonical owner capability 是 Agent Domain 的 `registerRole` / credential management；`role register <gpt-url>` 只是显式 CLI wrapper。

正常部署顺序：

```text
1. Provisioning Driver 返回已确认的 real g-id / carrierUrl
2. Agent Domain 解析并规范化 roleRef
3. 校验当前 Agent Package 与 roleRef 的一对一约束
4. 持久化 RegisteredRole
5. 生成 role-scoped Bearer credential
6. 仅在 Agent-owned secret store 持久化 credential
7. owning setup 临时读取 credential
8. Extension 通过独立 Provisioning command 机械填写 Action Authentication 并立即丢弃临时值
9. owner inspect + Gateway authenticated probe
```

一个 Role 一个 Key。Role Key 不属于 npm 静态材料，不属于 Browser Extension identity，也不得写入 Extension storage/runtime config/log/evidence。

---

# 8. Role Credential / Gateway 身份

Custom GPT Action：

```text
Authorization: Bearer <role-key>
```

Gateway：

```text
Bearer Key
→ Credential Store
→ authenticatedRoleRef
```

**不信任请求 body 自报 roleRef。**

对于 Task-scoped Action：

```text
authenticatedRoleRef
+ taskId
+ workerRef（业务需要时）
→ Task Public API / Task binding validation
```

至少防御：

- authenticated role 必须是 Task 参与者；
- workerRef 必须与 Task 中该 role 的绑定一致；
- Action 必须属于该 Agent Package 静态允许集合；
- Task/Node 自己的 version/state/actor rules 由 Task Domain 最终校验。

---

# 9. Secret Store v1

v1 采用 `.proflow` 下的本地受限 secret 文件方案。

概念：

```text
.proflow/
└── agent/
    └── secrets/
        ├── role-credentials.json
        └── local-platform-token
```

要求：

```text
OS 文件权限尽可能仅当前用户可读写
Git ignore
禁止进入日志
禁止进入 Knowledge
禁止普通 Registry API 返回明文
禁止错误对象泄露完整 Key
```

明文 Key 只允许在用户明确执行本机管理命令时短暂查看；正常 Deployment 不要求用户复制 Key。Owning setup 直接从 Agent-owned secret store 读取本次 credential，经受限 Provisioning transport 临时交给 Extension 完成 Auth finalization。

---

# 10. rotate-role-key

v1 支持独立凭据轮换，不等同于 Role update。

```text
rotate-role-key <roleRef>
→ 校验 Role 存在
→ Agent Domain 生成 new Key
→ 原 Key revoke/replace
→ Agent-owned secret store 更新
→ roleRef 不变
→ Task 历史不变
→ owning setup / Provisioning Auth finalization 更新对应 GPT
→ validate
```

CLI 可显式触发轮换，但正常 Auth 更新仍不要求用户手工进入 GPT Web。

Key 泄露时不需要删除整个 Role。

---

# 11. Role 物理删除

第一版**只有物理删除**：

```text
no tombstone
no logical delete
no DELETED status
no delete/restore public API
```

本地：

```text
role delete
```

执行前必须：

```text
Agent package CLI/shell
→ Task Domain Public API
→ 查询是否存在非终态 Task 引用该 roleRef
```

若在用：

```text
ROLE_IN_USE
→ refuse delete
```

禁止通过直接查询 Task SQLite 完成这个判断。

允许删除时：

```text
physical delete Role Registry entry
+ physical delete/revoke corresponding Role secret
```

不调用 OpenAI 删除 GPT；用户是否删除 Custom GPT 是 ChatGPT Web 外部操作。

历史 Task 已保存的 opaque `roleRef` 继续存在，但 Agent Domain **不承诺**删除后仍能从 Registry 解析该历史 role metadata。

这正是物理删除语义；v1 不为了历史展示引入 tombstone。

---

# 12. Role 删除与历史 Task

终态 Task：

```text
Task 中旧 roleRef 保持原值
getRegisteredRole(oldRoleRef) → ROLE_NOT_FOUND（如果已经物理删除）
```

若历史审计必须展示当时的某些稳定业务信息，应由拥有该历史事实的领域在 Task 创建/执行时保存必要快照；不能依赖一个已被用户明确删除的当前 Role Registry。

---

# 13. Browser Extension 的身份不是 Role Key

Role Key 专用于：

```text
Custom GPT
→ public Gateway
```

Browser Extension 是本地平台组件：

```text
Browser Extension runtime
→ Execution Runtime Browser protocol surface
→ local-platform-token / runtime bridge credential

Browser Extension provisioning
→ deployment-only provisioning bridge credential
→ 可在单次 Auth finalization command 内短暂接收 Role credential
→ 不拥有、不持久化、不记录该 Role credential
```

两类身份必须分开，避免把平台组件伪装成某个 Agent Role。Role credential 的 transient handoff 不改变 ownership。

---

## 当前正式约束：Auth / Secret / Browser credential

- 一个 Role 一个 Gateway Bearer/API key 的 v1 方向保持；Authentication 与 authorization/policy 分离。
- Browser Extension 使用独立 local-platform credential，不复用 Role Bearer。
- Role credential 只由 Agent Domain owner 生成/持久化；Deployment 只协调 owner setup，Browser Extension 只做 ephemeral materialization；Public DTO/log/evidence/model context 不泄露 secret。


---

# 12. 2026-08-14 Identity 对齐

Role Registry 只回答“某个 `agentPackageRef/packageName` 当前部署的是哪个 `roleRef/g-id`”；它不回答某个 Task 里是谁工作。Task-scoped worker identity 统一来自 `TaskRoleBinding(agentPackageRef, roleRef, workerRef, conversationLocator)`。

```text
agentPackageRef = logical role type
roleRef          = deployed Custom GPT
workerRef        = Task Worker Conversation
credential       = GPT→Gateway secret
```

Browser 不拥有或持久化 Role credential；仅 Deployment Provisioning 的单次 Auth finalization 可以在内存中短暂接收。Task/Agent 不持久化 tab/frame。

# chatgpt-carrier — ChatGPT Web 外部资源观察器

## 模块定位与作用

`chatgpt-carrier` 只治理 ChatGPT Web 这一外部资源的当前可用性，不再维护具体 Custom GPT 的 URL、Role、Actions、Auth、Knowledge 或 Capabilities 第二真源。

## 主要能力

- 机器探测 `https://chatgpt.com/` 当前是否可访问。
- 将真实外部可用性映射为 `READY / ACTION_REQUIRED`，不从历史记录伪造 READY。
- `setup / status / verify` 都重新观察当前现实，不要求用户粘贴 GPT URL 或人工勾选能力确认。

## 提供的 API 与 Public Contract

- 不提供新的业务 Contract；只通过标准 Module `status/setup` 暴露 ChatGPT Web 当前可用性。
- `configSlots = []`；不发布 GPT URL、Role 或 credential shared facts。

## 依赖的 Module、Contract 和外部资源

- 外部资源仅为 `https://chatgpt.com/` 当前可访问性。
- 具体 Custom GPT 的 Role/Auth/Actions 由 Agent Package、Browser Extension、Agent Runtime 和 Gateway owning flow 负责。

## 运行形态与生命周期

类型为 External Resource，无 ProFlow-owned 常驻进程；`start/stop` 不接管 ChatGPT 页面或会话。

## 具体 Custom GPT 的 Owner

三个角色的 GPT materialization 与验证继续由 owning Agent Package + Browser Extension + Agent Runtime 完成：

```text
Agent Package material
→ Browser Extension provisioning
→ Role Registry / credential
→ Gateway probe
```

因此本模块不复制 `carrierUrl`，也不保存 capability verification 文件。
## 使用方式

```text
platform setup --module chatgpt-carrier
platform status
```

没有 `carrierUrl`、`--confirm-capabilities` 或编号式人工 setup 步骤。

## ACTION_REQUIRED 边界

只有 ChatGPT Web 网络/平台可用性当前无法确认时，本模块才返回 `ACTION_REQUIRED`。ChatGPT 登录、具体 GPT materialization、Auth 与 Role readiness 由对应 owning flow 自己报告，不能复制成这里的第二份状态。

## 职责边界

- 不创建、编辑或删除具体 GPT。
- 不拥有 Agent Role / Worker / Conversation identity。
- 不把 HTTP 可达等同于具体 Agent Role READY。
- 不持久化用户手填 URL 或人工 capability confirmation。

## 职责边界与限制

本模块不创建、编辑、删除或验证具体 GPT，也不以 ChatGPT Web 可达性替代 Role/Gateway 的实时真值。

## 术语

- **ChatGPT Web**：由 OpenAI 运营的外部 Web 产品。
- **Carrier availability**：该 Web 外部资源当前可观察的可访问性，不等于任何具体 Role READY。

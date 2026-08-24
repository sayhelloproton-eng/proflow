# chatgpt-carrier — ChatGPT Web 外部资源观察器

## 模块定位与作用

`chatgpt-carrier` 只治理 ChatGPT Web 这一外部资源的当前可用性，不再维护具体 Custom GPT 的 URL、Role、Actions、Auth、Knowledge 或 Capabilities 第二真源。

## 主要能力

- 机器探测 `https://chatgpt.com/` 当前是否可访问。
- 将真实外部可用性映射为 `READY / ACTION_REQUIRED`，不从历史记录伪造 READY。
- `setup / status / verify` 都重新观察当前现实，不要求用户粘贴 GPT URL 或人工勾选能力确认。

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

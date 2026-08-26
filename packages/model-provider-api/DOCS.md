# model-provider-api — 模型服务适配器

## 模块定位与作用

治理一个真实 OpenAI-compatible 模型服务 URL，并向模型域发布经过验证的连接事实和模型 inventory。它是 External Resource adapter，不拥有远端服务进程，也不负责寻找服务地址。

## 主要能力

- 接收部署层提供的 HTTP(S) Provider URL。
- 优先调用真实 `/v1/models`，端点不存在时兼容 `/models`，并校验 inventory 合同。
- 区分 URL 缺失、URL 无效、不可达、认证要求、认证失败与协议无效；只有真实协议验证成功才 READY。
- 每次 `status` 都重新观察已绑定 URL，不能用历史文件冒充当前可用性。
- 只在服务真实要求认证时请求凭据；凭据写入 owner-only secret file，shared facts 只发布文件引用。

## 提供的 API 与 Public Contract

- 提供 `model.provider.api` Contract，版本 `1.0.0`。
- shared facts 仅包含验证后的 Provider API base URL、协议、真实模型清单、观测时间，以及可选 credential file reference。
- 不发布设备身份、发现协议、产品名称或 FAST/REASON 映射。

## 依赖的 Module、Contract 和外部资源

- 无上游 Module Contract 依赖。
- 唯一外部条件是一个已解析的 OpenAI-compatible HTTP(S) 服务 URL；地址发现属于模型域外的部署职责。

## 运行形态与生命周期

类型为 External Resource；远端服务进程不由 ProFlow 启停。`start` / `stop` 对该模块为可重复 no-op，`setup` / `status` 只负责 URL、认证和 inventory 的真实验证。

## 使用方式

```text
pnpm exec -- proflow-model-provider-api setup --provider-base-url <url>
pnpm exec -- proflow-model-provider-api verify
```

在完整 Platform 部署中，URL 应由部署层解析并转交，本模块不猜地址、不枚举设备，也不根据服务实现做分支。当前 Deployment-owned resolver 尚未裁决，因此缺 URL 时正常产品状态是 `ACTION_REQUIRED/ARCHITECTURE_STOP`；显式 `--provider-base-url` 只用于诊断、实验或 resolver 输出注入，不能退化成要求用户填写机器可发现 LAN 地址的正式流程。

## 职责边界与限制

模块不选择模型角色、不发现设备、不启动远端模型服务、不把单纯 TCP/HTTP 可达误判为 READY，也不把明文凭据写入日志、结果或 shared facts。

## 术语

- Provider URL：部署层解析出的 OpenAI-compatible 服务入口。
- Inventory：从 models endpoint 运行时验证得到的模型清单。
- Shared Fact：Owner Module 发布给依赖模块的已验证当前事实。

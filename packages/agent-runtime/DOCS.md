# agent-runtime

Agent Runtime（智能体运行时）管理角色登记、角色凭据和角色之间的协作消息。它作为库运行在 Platform Host 内部，不需要单独启动进程。

## 主要能力

- 保存固定角色与 Custom GPT 的绑定关系。
- 为角色签发和轮换访问凭据。
- 可靠记录角色之间的提问、回复与交付结果。

通常无需人工配置。使用 `platform status` 查看它是否就绪。

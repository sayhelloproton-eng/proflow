# chatgpt-carrier

ChatGPT Carrier（ChatGPT 载体）负责确认真实 Custom GPT 是否满足 ProFlow 的运行要求，包括 Actions、认证和必要的 GPT 能力。

## 什么时候需要

首次选择 ProFlow 使用的 Custom GPT，或者 GPT 的 Actions、认证设置发生变化时使用。

## 如何配置

运行 `proflow-chatgpt-carrier setup`。向导会打开 Custom GPT 管理页面，说明需要检查的项目，收集 GPT 地址并执行验证。

该模块只接受真实的 ChatGPT 状态；页面尚未完成配置时会保持“需要操作”，不会假装已经就绪。

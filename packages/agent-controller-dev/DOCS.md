# agent-controller-dev

为 ProFlow 准备总控与研发角色使用的 Custom GPT。它负责理解任务、组织研发工作，并通过受控的 Execution（执行服务）完成真实代码操作。

## 什么时候需要

首次部署总控/研发角色，或者角色的 Instructions（指令）、Actions（动作接口）发生升级时使用。

## 如何配置

运行 `pnpm exec -- proflow-agent-controller-dev setup`。向导会准备角色资料，引导你打开 Custom GPT 编辑页面，最后登记 GPT 地址并验证角色状态。

## 相关术语

- Custom GPT（自定义 GPT）：承载角色指令和 Actions 的 ChatGPT 应用。
- Worker（工作角色实例）：任务中实际参与协作的角色实例。

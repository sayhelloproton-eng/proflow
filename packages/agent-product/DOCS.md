# agent-product

为 ProFlow 准备产品角色使用的 Custom GPT。它负责梳理需求、维护产品上下文，并通过 Actions 与任务系统协作。

## 什么时候需要

首次部署产品角色，或者产品角色的 Instructions（指令）与 Actions（动作接口）发生变化时使用。

## 如何配置

运行 `pnpm exec -- proflow-agent-product setup`。向导会准备需要填写的内容、打开 Custom GPT 编辑入口，并在完成后登记和验证 GPT 地址。

## 相关术语

- Product Role（产品角色）：负责需求与产品决策的固定协作角色。
- Actions（动作接口）：Custom GPT 调用 ProFlow 服务的接口。

# agent-test-ops

为 ProFlow 准备测试与运维角色使用的 Custom GPT。它负责验证交付结果、整理 Evidence（验证证据）并协助运行维护。

## 什么时候需要

首次部署测试/运维角色，或者角色指令和 Actions（动作接口）发生升级时使用。

## 如何配置

运行 `pnpm exec -- proflow-agent-test-ops setup`。向导会准备角色资料、打开 Custom GPT 编辑入口，并在完成后登记和验证 GPT 地址。

## 相关术语

- Evidence（验证证据）：能够证明测试或真实操作结果的记录。
- Test/Ops Role（测试/运维角色）：负责质量验证和运行维护的固定角色。

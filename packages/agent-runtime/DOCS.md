# agent-runtime — 智能体运行与协作内核

## 模块定位与作用

承载 Role、Worker、Conversation、Message Thread 和协作投递等智能体运行模型，是三个 Agent Package 与 Task/Execution 之间的领域内核。

## 主要能力

- 管理稳定 Role 注册、Task Worker 绑定和 Conversation 定位信息。
- 管理 askPeer/replyPeer 等协作消息及投递状态。
- 提供角色注册、校验和凭据轮换的公开应用接口。

## 提供的 API 与 Public Contract

- 提供 `agent-runtime` Contract，版本 `1.0.0`。
- 对外公开 Role Management、Worker Binding 与 Collaboration 应用接口。

## 依赖的 Module、Contract 和外部资源

- 依赖 `task-orchestration`，兼容版本 `>=1.0.0 <2.0.0`。
- 依赖 `execution`，兼容版本 `>=1.0.0 <2.0.0`。

## 运行形态与生命周期

类型为 Library（领域库），由 Platform Host 组合运行，本身没有独立进程。

## 使用方式

业务模块通过公开 exports 或 Platform Host 应用端口使用；部署状态通过 `platform status` 查看。

## 职责边界与限制

不拥有 Task 状态机、真实 Effect、Browser 页面控制或模型推理；跨领域调用只能经过 Public Contract。

## 术语

- Worker（工作角色实例）：某个 Task 中由 Role 承担工作的稳定参与者。
- Conversation（会话）：Worker 在 Carrier 上持续复用的交互通道。
- Collaboration（协作）：角色之间可追踪的消息与投递过程。

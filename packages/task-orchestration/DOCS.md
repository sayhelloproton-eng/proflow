# task-orchestration — 任务与编排内核

## 模块定位与作用

拥有 Task、Plan、Node、TaskRoleBinding 和 TaskDocument 等核心业务模型，负责确定性的任务状态推进与并发控制。

## 主要能力

- 创建 Task、维护 Plan/Node 依赖和 READY 判定。
- 绑定固定 Agent Worker，管理 start/complete/wait/reopen 等状态转换。
- 提供 Task Document、版本控制、幂等和异常诊断入口。

## 提供的 API 与 Public Contract

- 提供 `task-orchestration` Contract，版本 `1.0.0`。
- 公开 Task Application、Worker Binding、Node Command 与查询端口。

## 依赖的 Module、Contract 和外部资源

- 无上游 Module Contract 依赖。
- 持久化由实现该领域端口的 Store Module 提供。

## 运行形态与生命周期

类型为 Library，由 Platform Host 组合运行，本身没有独立进程。

## 使用方式

通过公开应用端口创建和推进 Task；外部模块不得直接修改内部 Entity 或数据库表。

## 职责边界与限制

不执行真实 Effect、不控制 Browser、不管理 Agent 会话，也不调用模型完成普通确定性推进。

## 术语

- Task（任务）：从需求到结果的业务聚合根。
- Node（节点）：具有依赖、Owner 和状态的可执行工作单元。
- TaskRoleBinding（任务角色绑定）：Task 与稳定 Worker 的关系。

# @tomflow/proflow-task-store-sqlite

Task Domain 的 `node:sqlite` store、transaction 与 repository adapters。业务状态决策仍由 task-orchestration 拥有。

当前持久化包含 TaskRoleBinding 等 Task-owned facts；不把 simple Task start authorization、Browser tab/frame、System Observer assessment、Execution/Collaboration pending mirror 持久化为 Task truth。

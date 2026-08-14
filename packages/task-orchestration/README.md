# @tomflow/proflow-task-orchestration

Task & Orchestration 的 Public Contract、领域规则、应用服务与基础设施 ports。规范真源位于 `spec/任务与编排领域/`。

v1 New Task 由 Extension/application 先 `createTask(PENDING)`；Task owns `TaskRoleBinding(agentPackageRef, roleRef, workerRef, conversationLocator)`、Requirement/document relations、deterministic readiness、Node/runNo/reopen/terminal truth。Simple start confirmation 不产生 Task approval/authorization fact。Task Observer 只读取 drive projection并请求 WAKE/RESUME，Worker 在 READY wake 后正式 `startNode`。

# task-orchestration

Task Orchestration（任务编排）管理 Task、Task Group、Node、角色绑定和任务文档，是任务生命周期的业务真相来源。

## 主要能力

- 创建、启动、推进、重开和终止任务。
- 管理节点顺序以及角色与 Worker（工作实例）的绑定。
- 保存任务文档和状态变更记录。

它作为库运行在 Platform Host 中，没有独立进程，也不需要人工配置。

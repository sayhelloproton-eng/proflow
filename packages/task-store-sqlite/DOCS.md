# task-store-sqlite — Task SQLite 存储

## 模块定位与作用

使用 Node 原生 SQLite 实现 Task 领域定义的 Repository 与事务端口，负责可靠保存任务、节点、文档和绑定事实。

## 主要能力

- 提供 Schema 初始化、事务、Prepared Statement 和 WAL 配置。
- 保存 Task 聚合、Node、TaskDocument 与 Role Binding。
- 执行并发版本检查和原子写入，支持进程重启后的恢复。

## 提供的 API 与 Public Contract

- 不提供新的逻辑 Contract；实现 `task-orchestration` 中定义的持久化端口。
- 只通过公开 Repository 接口访问，不公开内部 SQL 表作为跨域 API。

## 依赖的 Module、Contract 和外部资源

- 依赖 `task-orchestration`，兼容版本 `>=1.0.0 <2.0.0`。
- 依赖 Node `node:sqlite` 与 Workspace 中受控的数据库路径。

## 运行形态与生命周期

类型为 Library，数据库连接由组合根管理，无独立服务进程。

## 使用方式

由 Platform Host 在启动时构造 Store 并注入 Task 应用服务；迁移通过专用 Migration Runner 执行。

## 职责边界与限制

不定义 Task 业务规则、不允许其他领域直接查询表，也不把 SQLite 文件路径作为用户配置。

## 术语

- Repository（仓储）：领域模型访问持久化的公开端口。
- WAL（预写式日志）：SQLite 的并发与恢复日志模式。
- Transaction（事务）：保证一组写入全部成功或全部撤销的边界。

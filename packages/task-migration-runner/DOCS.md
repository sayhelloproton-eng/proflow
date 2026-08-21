# task-migration-runner — Task 数据迁移工具

## 模块定位与作用

以受控 CLI 执行 Task SQLite Schema 迁移，确保数据库版本升级可追踪、可重复且不会混入 Runtime 启动逻辑。

## 主要能力

- 读取当前 Schema 版本并按顺序执行待应用迁移。
- 在事务中应用迁移，失败时停止并保留诊断信息。
- 报告已应用版本与最终状态。

## 提供的 API 与 Public Contract

- 不提供跨 Module 逻辑 Contract。
- 提供 `proflow-task-migrate` CLI；返回强类型结果，不提供 `--json`。

## 依赖的 Module、Contract 和外部资源

- 无上游 Module Contract 依赖。
- 依赖 Node.js、Task SQLite 文件和迁移资源。

## 运行形态与生命周期

类型为 CLI，按需运行后退出，没有常驻进程。

## 使用方式

部署或版本升级流程调用 `proflow-task-migrate`；执行前必须使用明确 Workspace 和数据库边界。

## 职责边界与限制

不承载 Task 业务服务、不自动猜测数据库位置，也不在失败后跳过迁移继续启动。

## 术语

- Migration（迁移）：把持久化结构从一个已知版本升级到下一版本的操作。
- Schema Version（结构版本）：当前数据库结构对应的有序版本号。

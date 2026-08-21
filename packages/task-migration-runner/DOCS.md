# task-migration-runner

Task Migration Runner（任务迁移工具）负责按顺序升级 Task Store（任务存储）的 SQLite 数据结构，并验证升级结果。

## 主要能力

- 发现尚未执行的 Migration（迁移）。
- 在事务中执行升级，失败时回滚。
- 记录版本并支持重复运行。

平台安装时会自动调用它；普通用户通常不需要手工执行。

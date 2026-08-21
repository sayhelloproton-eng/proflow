# execution-runtime

Execution Runtime（执行运行时）是 ProFlow 真实操作的控制中心。它负责审批、幂等、执行调度、结果记录和异常恢复。

## 使用前提

本机执行器、浏览器执行器、模型运行时和 Platform Host 提供的身份信息必须就绪。缺少上游事实时，状态会显示失败并由 `platform setup` 给出原因。

## 运行方式

配置完成后使用 `platform start` 启动。不要直接修改它在 `.proflow` 中维护的数据库和凭据。

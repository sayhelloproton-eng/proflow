# platform-host

Platform Host（平台主服务）把 Task、Agent、Execution 和 Model 等模块组合成一个本机应用，并提供受认证的本地接口。

## 主要职责

- 装配各领域运行时并管理启动与停止。
- 提供本机 HTTP 接口和健康状态。
- 把请求转给真正拥有数据和规则的模块。

它不保存第二份业务数据，也不负责浏览器中的 Observer（观察器）循环。

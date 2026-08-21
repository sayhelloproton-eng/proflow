# platform-cli

Platform CLI（平台命令行）是 ProFlow 的统一管理入口，负责发现模块、安装依赖、汇总状态和按依赖顺序启动或停止模块。

## 推荐流程

`platform install` → `platform status` → `platform docs` → `platform setup` → `platform start`

## 边界

Platform CLI 只负责调用和汇总，不读取模块私有配置，也不替模块解释外部服务。具体配置由对应模块的 Setup（配置向导）完成。

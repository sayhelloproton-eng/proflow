# platform-cli — ProFlow 管理命令行

## 模块定位与作用

ProFlow 的薄管理面，负责从 Registry 发现 Module、同步 npm 包、解析依赖顺序，并转发和聚合七标准命令。

## 主要能力

- 安装、卸载并验证完整 Module 包集合。
- 聚合 status、docs 和 setup，不解释 Module 私有业务。
- 按依赖顺序启动、按逆依赖顺序停止，并支持幂等重试。

## 提供的 API 与 Public Contract

- 不提供领域业务 Contract。
- 提供 `platform` CLI；`runCli()` 返回强类型 `CliOutcome`，终端层负责中文渲染。

## 依赖的 Module、Contract 和外部资源

- 依赖 npm Registry、当前 Workspace package manager 和所有 discovered Module 的公开 adapter。
- 不 deep import Module 私有代码，不读取 Module 私有配置。

## 运行形态与生命周期

类型为 CLI，命令执行结束后退出；不是业务 Runtime 或长期守护进程。

## 使用方式

推荐顺序为 `platform install`、`status`、`docs`、`setup`、`start`、`stop`、`uninstall`。

## 职责边界与限制

不代理业务 API、不保存 Module setup 输入、不建立 preflight/doctor 第二真源，也不提供 JSON 输出选项。

## 术语

- Discovery（发现）：从 Registry 与 Workspace 识别 governed Module。
- Aggregation（聚合）：保留各 Module 结果并以统一终端形式展示。
- Dependency Order（依赖顺序）：Provider 先于 Consumer 的生命周期顺序。

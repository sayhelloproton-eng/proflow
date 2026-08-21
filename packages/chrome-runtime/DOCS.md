# chrome-runtime — Chrome 运行环境

## 模块定位与作用

发现并观察本机真实 Google Chrome，为 Browser Extension 和 ChatGPT 页面操作提供受治理的浏览器运行环境。

## 主要能力

- 探测 Chrome 可执行文件、版本和可启动性。
- 将浏览器现实映射为 Module setup/runtime 状态。
- 为 Extension setup 提供明确的外部运行前提。

## 提供的 API 与 Public Contract

- 不提供新的逻辑 Contract；通过 Module status 暴露当前浏览器事实。
- 标准 start/stop 只表达可控制范围，不伪造对用户浏览器会话的所有权。

## 依赖的 Module、Contract 和外部资源

- 依赖受支持的 Google Chrome 安装和当前操作系统权限。
- 无上游 Module Contract 依赖。

## 运行形态与生命周期

类型为 External Resource。Chrome 是用户拥有的外部进程，模块负责发现和观察，不接管用户标签页。

## 使用方式

安装后运行 `platform status` 查看探测结果；需要浏览器操作时由对应 Extension setup 打开准确页面。

## 职责边界与限制

不读取浏览历史，不擅自关闭或导航用户标签页，也不把“已安装”误当成 Extension 已就绪。

## 术语

- Runtime（运行环境）：承载 Browser Extension 的真实 Chrome 实例。
- External Resource（外部资源）：不由 ProFlow 创建但必须纳入状态治理的资源。

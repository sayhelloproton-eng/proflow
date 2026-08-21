# execution-browser-extension

Execution Browser Extension（浏览器执行扩展）让 ProFlow 在 Chrome 中执行受控页面操作、采集页面证据，并提供任务与审批界面。

## 什么时候需要

首次部署浏览器能力、扩展升级，或者 Chrome 报告扩展未连接时使用。

## 如何配置

运行 `proflow-execution-browser-extension setup`。向导会准备扩展目录、打开 Chrome 扩展管理页，并说明如何加载已解压扩展；完成后收集 Extension ID（扩展标识）并验证连接状态。

扩展不保存 Task（任务）或 Approval（审批）的业务真相，只负责浏览器侧交互。

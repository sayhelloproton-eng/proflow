# execution-local — 本地执行能力

## 模块定位与作用

提供受控的本地文件、进程、Shell、Git 和测试执行能力，把真实本机副作用转换为标准 Execution 结果与证据。

## 主要能力

- 校验工作目录、参数和允许的操作边界。
- 执行本地 Effect，捕获 stdout/stderr、退出码和文件变化。
- 生成可供上层恢复和审计的 Evidence。

## 提供的 API 与 Public Contract

- 提供 `execution-local` Contract，版本 `1.0.0`。
- 公开 Local Executor 端口，不暴露任意未校验的系统调用。

## 依赖的 Module、Contract 和外部资源

- 无上游 Module Contract 依赖。
- 依赖 Workspace 文件系统及被请求工具的本地可执行文件。

## 运行形态与生命周期

类型为 Library，由 Execution Runtime 组合调用，无独立进程。

## 使用方式

通过 Execution Runtime 提交本地执行 Intent；不要绕过 Runtime 直接从其他领域调用内部 Adapter。

## 职责边界与限制

不判断 Task 是否完成，不拥有审批策略，也不执行 Browser Effect。

## 术语

- Local Executor（本地执行器）：对当前 Workspace 产生受控副作用的实现。
- Exit Code（退出码）：本地进程报告成功或失败的数字状态。
- Workspace（工作区）：允许执行和保存证据的项目根目录。

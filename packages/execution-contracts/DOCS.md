# execution-contracts — 执行契约类型

## 模块定位与作用

定义 Execution 领域的 Intent、Effect、Result、Evidence 和错误等稳定类型，使调用方只依赖公开语义。

## 主要能力

- 提供执行请求、结果、证据和恢复状态的强类型定义。
- 在外部输入进入领域前完成运行时校验。
- 统一 Local 与 Browser Effect 的公共语言。

## 提供的 API 与 Public Contract

- 不在 Module Graph 中声明独立逻辑 Contract；类型通过包的公开 exports 提供。
- 公开 TypeScript 类型和 Zod 边界 Schema。

## 依赖的 Module、Contract 和外部资源

- 无上游 Module Contract 或外部服务依赖。
- 运行时要求 Node.js 24.19.0 或更高版本。

## 运行形态与生命周期

类型为 Library，无独立进程、端口或持久化状态。

## 使用方式

Execution 实现和调用方通过公开包入口导入类型与 Schema，不使用 deep import。

## 职责边界与限制

只定义合同，不执行命令、不控制浏览器、不保存 Evidence，也不决定业务成功。

## 术语

- Intent（意图）：调用方希望产生的执行目标。
- Effect（副作用）：对文件、进程或浏览器产生的真实变化。
- Evidence（证据）：证明执行结果的可追溯事实。

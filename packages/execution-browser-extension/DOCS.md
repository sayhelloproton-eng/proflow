# execution-browser-extension — 浏览器执行扩展

## 模块定位与作用

Execution 领域拥有的 Chrome MV3 Extension，负责 Task UI、审批提醒、Conversation Carrier 和真实 Browser Effect。

## 主要能力

- 提供 New Task 与 Side Panel UI、Task Observer 和 System Observer。
- 创建、恢复和唤醒 Custom GPT Conversation，稳定观察 workerRef/c-id。
- 执行 DOM-first 浏览器操作，必要时使用截图与 Vision 辅助观察。

## 提供的 API 与 Public Contract

- 提供 `execution-browser-executor` Contract，版本 `1.0.0`。
- 通过本地 Bridge 接收 typed Browser operation 并返回 Evidence。

## 依赖的 Module、Contract 和外部资源

- 依赖 `execution`、`task-orchestration` 和 `agent-runtime`，兼容版本均为 `>=1.0.0 <2.0.0`。
- 依赖 Chrome、用户加载 MV3 扩展和真实 ChatGPT 页面。

## 运行形态与生命周期

类型为 Browser Extension。后台 Service Worker 由 Chrome 管理，本地配置由 Module setup 生成。

## 使用方式

运行 `pnpm exec -- proflow-execution-browser-extension setup`，加载准备好的目录、登记 Extension ID、Reload 并验证 Bridge。

## 职责边界与限制

不拥有 Task/Agent 业务事实，不依赖坐标点击，不维持 frame registry，也不创建第二套 Effect 状态机。

## 术语

- MV3（Manifest V3）：Chrome 扩展当前使用的清单与运行模型。
- Service Worker（后台服务）：Chrome 管理的扩展后台执行环境。
- DOM-first（DOM 优先）：优先使用结构化页面元素完成观察和操作。

# execution-browser-extension — 浏览器执行扩展

## 模块定位与作用

Execution 领域拥有的 Chrome MV3 Extension，负责 Task UI、审批提醒、Conversation Carrier 和真实 Browser Effect。

## 主要能力

- 运行期提供 New Task 与 Side Panel UI、Task Observer、System Observer 和 Browser Effect。
- 运行期创建、恢复和唤醒 Custom GPT Conversation，稳定观察 workerRef/c-id。
- 部署期通过独立 `/gpts/editor` / `/gpts/editor/*` Provisioning Surface 物化 Custom GPT；该分支不进入 Task/Worker 状态机。
- 正常创建路径在单一 GPT Editor 会话中完成字段、Action Schema、API Key/Bearer、Knowledge ZIP、模型与 Capabilities 配置，再创建 Private GPT；不在 Create 后重新打开同一 GPT 做 Auth。
- Knowledge Bundle 在 Mac 侧先做 ZIP traversal/大小/内部类型校验，最终向 GPT Knowledge 上传 `custom-gpt-knowledge.zip` 本体；不把解包后的 `.md` 逐文件作为正常上传物。
- `FINALIZE_CUSTOM_GPT_AUTH` 只保留为显式 recovery/repair primitive，不属于正常 `createCustomGptRole` Golden Path。
- 执行 DOM-first 浏览器操作，必要时使用截图与 Vision 辅助观察。

## 提供的 API 与 Public Contract

- 提供 `execution-browser-executor` Contract，版本 `1.0.0`，仅用于运行期 Browser Execution。
- 提供 `custom-gpt-web-provisioning` Contract，版本 `1.0.0`，仅用于部署期 Custom GPT Web Provisioning。
- 两条能力只共享 Extension/loopback transport 等底层设施，不共享业务状态机。
- 通过本地 Bridge 接收 typed Browser operation 并返回 Evidence。

## 依赖的 Module、Contract 和外部资源

- 依赖 `execution`、`task-orchestration` 和 `agent-runtime`，兼容版本均为 `>=1.0.0 <2.0.0`。
- 依赖 Chrome、用户加载 MV3 扩展和真实 ChatGPT 页面。

## 运行形态与生命周期

类型为 Browser Extension。后台 Service Worker 由 Chrome 管理，本地配置由 Module setup 生成。

## 使用方式

运行 `platform setup --workspace <workspace>`。ProFlow 会先准备 unpacked 目录、运行配置和本地 Bridge，并用真实 hello + heartbeat 尝试重验证已有扩展；已有扩展仍在线时不会再次打扰用户。只有未检测到在线扩展时，ProFlow 才按步骤打开 `chrome://extensions/`、确认开发者模式、复制正确目录并指导加载。完成后无需输入任何标识或状态；扩展身份、session、hello/heartbeat、Browser Executor 配置和 setup evidence 都由模块自行发现、生成并验证。历史 pairing evidence 不能单独代替本次 live revalidation。

若 pairing 等待超时，ProFlow 保留已经准备好的扩展文件和机器配置，不写伪 READY evidence，并输出稳定错误代码 `PAIRING_TIMEOUT`。用户确认 Chrome 已完成加载后重新执行 `platform setup` 即可。Agent setup 随后通过 `custom-gpt-web-provisioning` 使用同一 Extension package 的部署期分支。

## 职责边界与限制

不拥有 Task/Agent 业务事实，不依赖坐标点击，不维持 frame registry，也不创建第二套 Effect 状态机。

## 术语

- MV3（Manifest V3）：Chrome 扩展当前使用的清单与运行模型。
- Service Worker（后台服务）：Chrome 管理的扩展后台执行环境。
- DOM-first（DOM 优先）：优先使用结构化页面元素完成观察和操作。

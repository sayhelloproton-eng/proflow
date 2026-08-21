# module-skill — Module 工程指导

## 模块定位与作用

为人类和 AI 提供创建、修改和审计 ProFlow Module 的工程步骤，确保工作始终回到 owning Module 与当前规范。

## 主要能力

- 指导识别 Domain、Owner、Provides/Requires 和真实运行边界。
- 指导维护 descriptor、adapter、DOCS、SETUP 与测试证据。
- 在配置或生命周期缺口出现时定位 owner seam，而不是向 Platform 堆积特判。

## 提供的 API 与 Public Contract

- 不提供运行时逻辑 Contract。
- 以可复用 Skill 文档形式提供渐进式工程工作流。

## 依赖的 Module、Contract 和外部资源

- 无上游 Module Contract 依赖。
- 使用当前 `spec/`、Module Contract、Template 和 Conformance 作为事实来源。

## 运行形态与生命周期

类型为 Library/知识包，无独立进程或业务状态。

## 使用方式

在新增 Module、调整依赖、修改 Setup 或处理 Conformance 失败时按 Skill 顺序执行。

## 职责边界与限制

不替代领域设计、不自动授权架构变更，也不把历史或旧仓库当作当前实现真源。

## 术语

- Owner Seam（所有者接缝）：应由能力所有模块提供的可执行接口或事实边界。
- Progressive Disclosure（渐进式披露）：按任务需要逐层读取相关资料。

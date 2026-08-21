# module-template — Module 工程模板

## 模块定位与作用

把标准 Module Contract 机械生成 TypeScript/npm 工程骨架，为六种 Module kind 提供一致、可发布的起点。

## 主要能力

- 生成 descriptor、adapter、package metadata、测试和标准七命令管理面。
- 生成结构化 DOCS.md 与可执行 SETUP.md。
- 根据 Library、Service、CLI、Browser Extension、Agent Package、External Resource 生成最小差异。

## 提供的 API 与 Public Contract

- 不提供业务逻辑 Contract。
- 公开 `materializeModule` API 与 `proflow-module-template create` CLI。

## 依赖的 Module、Contract 和外部资源

- 无上游 Module Contract 依赖。
- 依赖文件系统写入目标目录和当前 Module Contract 类型。

## 运行形态与生命周期

类型为 Library，CLI 按需生成文件后退出，无常驻进程。

## 使用方式

提供 moduleRef、package、kind、domain 和 summary 创建骨架；随后由领域 Owner 补齐真实能力与 Setup。

## 职责边界与限制

不生成领域业务、不发明 Provides/Requires，也不让通用模板成为 Platform-specific workflow。

## 术语

- Scaffold（工程骨架）：满足公共结构但仍需 Owner 实现业务的初始文件集合。
- Profile（模板类型）：与 Module kind 对应的最小工程差异。

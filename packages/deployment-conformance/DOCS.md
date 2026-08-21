# deployment-conformance

Deployment Conformance（部署一致性检查）用于验证一个 ProFlow 模块是否具备完整、可发布、可被平台管理的工程结构。

## 主要检查

- Module Contract（模块合同）是否合法。
- npm 包中的描述文件、文档和入口是否齐全。
- 七个标准管理命令是否遵守边界。

它面向模块开发和发布流程，普通平台使用者通常不需要单独运行。

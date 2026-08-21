# module-contract — Module 治理合同

## 模块定位与作用

定义 Platform、Module Template、Conformance 和所有业务 Module 共同使用的唯一治理合同与运行时 Schema。

## 主要能力

- 定义 Module descriptor、七标准管理命令和 operation result。
- 定义 setup/runtime 状态、Docs 数据和可执行 Setup Step。
- 在 Registry、文件和 adapter 等边界把 unknown 数据验证为可信类型。

## 提供的 API 与 Public Contract

- 不在 Module Graph 中声明业务 Contract；通过包 exports 提供治理类型、Schema 和辅助函数。
- 标准管理面固定为 install、uninstall、status、setup、docs、start、stop。

## 依赖的 Module、Contract 和外部资源

- 无上游 Module Contract 或外部服务依赖。
- 运行时校验使用 Zod，执行环境要求 Node.js 24.19.0 或更高版本。

## 运行形态与生命周期

类型为 Library，无独立进程；被所有 governed Module 在构建和运行时消费。

## 使用方式

Module 通过公开 exports 定义 descriptor、校验 command context，并返回强类型 operation result。

## 职责边界与限制

不实现任何业务 Module、不保存 Platform 状态，也不允许 Platform 建立第二套配置或健康真源。

## 术语

- Descriptor（描述符）：Module 身份、依赖、要求和效果的机器合同。
- Adapter（适配器）：Module 对七标准管理命令的 owning 实现。
- Boundary Validation（边界校验）：外部数据成为可信类型前的运行时验证。

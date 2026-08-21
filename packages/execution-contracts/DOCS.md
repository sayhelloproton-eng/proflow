# execution-contracts

Execution Contracts（执行合同）定义 ProFlow 执行请求、结果、错误、Artifact（产物）和 Evidence（证据）的公共数据格式。

## 主要用途

- 让不同模块使用同一套强类型接口。
- 在外部输入进入系统时进行格式校验。
- 区分执行结果、产物引用和验证证据。

这是一个库模块，没有独立进程，也不需要人工配置。

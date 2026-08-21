# execution-local

Execution Local（本机执行器）负责文件、Git、进程和受限网络等真实本机操作，由 Execution Runtime 调用。

## 主要能力

- 在指定项目范围内读写文件和执行 Git 操作。
- 启动受控进程并限制输出、超时和环境变量。
- 生成 Context Pack（上下文包）与 Patch（补丁）产物。

它是库模块，不单独启动；所有真实操作仍受 Execution Policy（执行策略）约束。

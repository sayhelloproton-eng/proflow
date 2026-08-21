# model-runtime

Model Runtime（模型运行时）为 ProFlow 提供 FAST（快速模型）和 REASON（推理模型）两类推理通道。

## 什么时候需要

模型服务就绪后，需要为两类工作选择具体模型时使用。

## 如何配置

运行 `pnpm exec -- proflow-model-runtime setup`。向导会先检查模型服务，再提示选择 FAST 和 REASON 模型，保存后立即验证两条通道。

FAST 适合常规判断；REASON 用于复杂诊断。运行时不会在两者之间进行隐式降级。

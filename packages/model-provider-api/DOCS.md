# model-provider-api

Model Provider API（模型服务接口）负责连接和检查一个 OpenAI-compatible（兼容 OpenAI 协议）的模型服务。

## 什么时候需要

首次选择模型服务、服务地址变化或认证方式变化时使用。

## 如何配置

运行 `pnpm exec -- proflow-model-provider-api setup`。向导会解释地址格式、检查服务连通性；需要认证时，只接受模块支持的安全凭据方式。

该模块只确认服务可访问，不替 Model Runtime 判断具体模型是否适合 FAST 或 REASON。

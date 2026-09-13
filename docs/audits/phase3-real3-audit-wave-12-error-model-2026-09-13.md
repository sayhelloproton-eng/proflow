# Phase 3 / Real-3 Audit Wave 12｜错误模型

日期：2026-09-13

## Scope

审计 `OWNER_SERVICE_UNAVAILABLE / LOCAL_TOOL_RESULT_UNKNOWN / CONTEXT_MISMATCH / WAITING / UNKNOWN / retryable` 在 Gateway、Host、Task、Execution、Carrier 之间的归属与翻译，重点排除技术失败误映射业务 WAITING、UNKNOWN 被丢失以及跨层二次翻译。

## Evidence

- Task Contract 明确：Execution UNKNOWN、Carrier uncertainty、Collaboration pending 不自动映射 Task WAITING；只有 Worker 明确业务 blocker 才可正式 `waitNode`。
- 全仓 `waitNode` 调用搜索未发现 Observer/Host/Execution 技术恢复路径自动调用；实际调用面限于 Task 正式 command surface、Role allowlist/instructions 与测试。
- Host Direct Tool route 对 bridge error 已区分：`LOCAL_TOOL_COMMAND_TIMEOUT=504`、`LOCAL_TOOL_RESULT_UNKNOWN=409`、`LOCAL_TOOL_PROVIDER_UNAVAILABLE=503`、`LOCAL_TOOL_COMMAND_FAILED=500`。
- Gateway 下游翻译原先在解析 safe downstream code 之后仍以 `status >= 500` 优先覆盖为 `OWNER_SERVICE_UNAVAILABLE`；因此 timeout/provider-unavailable/known tool failure 被错误折叠，只有 409 UNKNOWN 幸免。
- Browser Permission `CONTEXT_MISMATCH` 保持 Carrier policy reason/HUMAN_REQUIRED，不进入 Task state。

## Findings

### W12-F01｜VALID｜Gateway 折叠安全 typed 5xx，丢失 owner/error semantics

下游已经明确且 allowlisted 的 `LOCAL_TOOL_COMMAND_TIMEOUT / LOCAL_TOOL_PROVIDER_UNAVAILABLE / LOCAL_TOOL_COMMAND_FAILED` 仍被 Gateway 因 HTTP 5xx 改写为 `OWNER_SERVICE_UNAVAILABLE`。这使调用方无法区分“Owner 不可达”与“Owner 已返回确定 Tool 结果”。

### W12-F02｜PASS｜技术失败未自动映射 Task WAITING

当前 owner/source path 没有 Observer/Host/Execution 自动调用 `waitNode` 的实现；Task WAITING 仍由正式 Worker command 显式创建。

### W12-F03｜PASS｜LOCAL_TOOL_RESULT_UNKNOWN 保留 no-blind-replay 语义

Host 将 potential-effect uncertain result 映射为 409 `LOCAL_TOOL_RESULT_UNKNOWN`；Gateway allowlist 已保留该 code。Execution/Tool 规范继续要求先 reality reconciliation，不把 retryable 当重放授权。

## Changes Applied

- Gateway error translation 改为：401 始终隐藏为 `OWNER_SERVICE_UNAVAILABLE`；其余状态先保留 allowlisted downstream error code；无安全 code 的 5xx 才折叠为 `OWNER_SERVICE_UNAVAILABLE`。
- Gateway regression 增加 504 timeout、503 provider unavailable、500 known tool failure 的 typed preservation，同时保留 unsafe 500 masking。
- Agent Public Contract 增补 Gateway error-translation boundary，并重申技术错误不得生成 Task WAITING。

## Verification Gate

- `agent-gateway-process.test.ts` targeted PASS。
- Agent Gateway typecheck PASS。
- Task lifecycle WAITING/FAILED boundary regression PASS。
- Direct Tool bridge timeout/UNKNOWN targeted PASS。

## Residual

- Gateway operation log 当前统一写 `sideEffectState=UNKNOWN` 属可观测性精度问题，进入 Wave 13，不在 Error Model 波次混改。
- `retryable` 在不同外层 transport envelope 的暴露一致性进入 Wave 18 Schema/Contract 对齐，不在本 Wave 发明新 public field。

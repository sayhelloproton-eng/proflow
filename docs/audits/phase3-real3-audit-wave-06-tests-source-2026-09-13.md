# Phase 3 / Real-3 Audit｜Wave 06｜Tests → Source

日期：2026-09-13
状态：DONE（以本 Wave frozen-decision targeted verify receipt 为准）

## Scope

只关闭 Wave 05 机械确认的两个 testability gap，不扩大到后续 Architecture/State/Deployment Wave：

1. recurring Background page-reality recovery 的 timer / in-flight dedupe；
2. Permission semantic action dispatch 的 success/failure operation-log emit。

## Findings / Source Closure

### W06-F01｜PARTIAL PROOF → BEHAVIOR PROOF｜page recovery 过去只有 source regex

新增 production helper `createPageRealityRecoveryLoop`：

- `start()` 只能成功调度一次；
- 固定使用传入 interval；
- 同一未结束 recovery pass 必须返回同一个 Promise，不启动第二次 recovery；
- scheduled recovery failure 只结束本次 pass，不制造 blind replay；
- `background.ts` 的 startup immediate recovery 与 10 秒 recurring recovery 都使用该 helper。

`page-reality-recovery.test.ts` 现在直接执行该 production helper，并另保留最小 source-wiring assertion 证明真实 Background 主链使用它。

### W06-F02｜PARTIAL PROOF → BEHAVIOR PROOF｜Permission action log 过去只有 source regex

新增 production helper `createPermissionActionLoggingPage`，并由 `background.ts` 的 Permission Controller page port 实际使用：

- semantic `permissionAction` 成功时 emit `PERMISSION_ACTION / DISPATCHED / SUCCEEDED / STARTED`；
- command 抛错时 emit `FAILED / PERMISSION_ACTION_FAILED / UNKNOWN` 后原样传播错误；
- fingerprint/action/tab/content/url/duration 进入结构化 operation event；
- 非 permission page command 原样透传且不制造 Permission log。

`permission-action-observability.test.ts` 直接执行 success/failure/bypass 三条行为，不再以读 `background.ts` 正则冒充 logger 行为证明；source read 只用于证明 production wiring。

## Boundary

本 Wave 不声称真实 Chrome SAME_SCENE 已重新验收。CP-EXE-BR-49 仍归最终 Real Chrome Gate；本 Wave 只把自动化 proof 从 source-presence 提升为 production-helper behavior + production wiring。

## Verification Contract

- targeted behavior tests：`page-reality-recovery.test.ts` + `permission-action-observability.test.ts`；
- Permission lifecycle regression：`permission-controller.test.ts` + `carrier-permission-lifecycle.test.ts`；
- `@tomflow/proflow-execution-browser-extension` typecheck；
- `git diff --check`。

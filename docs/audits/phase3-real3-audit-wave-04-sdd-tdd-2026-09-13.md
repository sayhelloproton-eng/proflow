# Phase 3 / Real-3 Audit｜Wave 04｜SDD → TDD 一致性

日期：2026-09-13
状态：DONE

## Scope

以 Wave 02/03 已校准的 current SDD 为输入，只审“关键设计不变量是否进入正式 Test Plan”；本 Wave 不修改 executable tests，不把后续测试实现问题混入 TDD 设计层。

## Evidence

- `TP-MODULE-EXECUTION-BROWSER-EXTENSION`
- `TP-MODULE-PLATFORM-HOST`
- `TP-MODULE-AGENT-GATEWAY`
- `TP-MODULE-TASK-ORCHESTRATION`
- Real-3 0.1.59–0.1.62 修复与 SAME_SCENE 运行证据
- 当前 Permission/Role/Task owner SDD（Wave 02/03 后版本）

## Findings / Changes Applied

### W04-F01｜STALE｜Extension TDD 仍把 Permission happy path 写成 Always Allow

CP-EXE-BR-06 与 Real/Fake boundary 已改为 shipped all-false ordinary path + unexpected Permission recovery；AUTO_ALLOW 只执行页面真实提供的 `allowAlways`，否则 `allow`，`allowOnce` 只人工。

### W04-F02｜MISSING｜Permission actuator TDD 缺 `allow`

旧 CP-EXE-BR-24 只枚举 `allowAlways/allowOnce/deny`，与当前 parser/lifecycle 支持动作不一致。已补成 `allowAlways/allow/allowOnce/deny`。

### W04-F03｜MISSING｜Real-3 最终暴露的 Permission liveness/retry 没进入正式 Test Plan

已新增 CP-EXE-BR-43..49：
- characterData observation；
- 10s bounded page-bottom watchdog；
- 10s recurring background recovery + in-flight dedupe + missing receiver reinjection；
- transient `PERMISSION_CLASSIFICATION_FAILED` retry；
- semantic allow fallback；
- action dispatch/release observability；
- SAME_SCENE no-refresh/no-human-click real gate。

并新增 RF-31..35 反例，禁止 startup-only recovery、watchdog click、transient failure 永久缓存、只记决策不记动作等回归。

### W04-F04｜MISSING｜Platform Host TDD 未冻结真实 GPT slug URL

Real-3 已证明真实 Conversation 使用 `g-<roleRef>-<slug>`。新增 CP-HOST-22 / RF-HOST-22：允许当前 slugged URL，同时拒绝 wrong role/worker/query/hash，不能通过“放宽 parser”修正误拒。

### W04-F05｜MISSING｜Role registration/version drift 的恢复语义缺少 Host TDD

新增 CP-HOST-23 / RF-HOST-23：classification 必须使用 current durable Role registration + validation facts；漂移 fail-closed，正式 adopt/reload 后必须 re-read current registration，禁止旧 Host cache 永久制造 `ROLE_VALIDATION_MISMATCH`。

### W04-F06｜VALID｜Task 与 Gateway TDD 已覆盖当前关键设计

Task Test Plan 已明确 same TaskRoleBinding Worker reopen、run-local workerRef clear/rebind、backend catch-up、Direct Tool result 不自动推进、terminal stop-driving。Gateway Test Plan 已明确 shipped operations all-false、false metadata 不等于本机授权、Direct Tool lane 与 operation readiness，因此本 Wave不为“完整性”重复新增同义 proof。

## Verification

- Extension CP-06 不再把 Always Allow 当 ordinary happy path。
- CP-24 必须包含 `allow`。
- CP-43..49 / RF-31..35 必须存在。
- Host CP-22/23 与 RF-22/23 必须存在。
- Task/Gateway test plan 不做无意义改写。
- `git diff --check` PASS。

## Residual / Carry Forward

Wave 05 直接进入 executable test tree：
1. 机械绑定 CP-43..48 到真实 test files；缺测试就补，过期断言就删/改。
2. 已知 `packages/agent-test-ops/tests/journey-native-capability-alignment.test.ts` 仍要求 `localDev consequential=true`，必须清理。
3. 检查 source/string-regex “测试”是否冒充行为 proof；需要 owner/runtime proof 的不能只 grep。
4. 08 测试目录中的旧 `AUTO_ALWAYS_ALLOW` / consequential=true catalog 等衍生漂移，等 executable tests 收敛后再按真源重建或清理，避免先修报表后修事实。

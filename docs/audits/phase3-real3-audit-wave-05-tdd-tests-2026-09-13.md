# Phase 3 / Real-3 Audit｜Wave 05｜TDD → executable tests

日期：2026-09-13
状态：DONE_WITH_CARRY_FORWARD

## Scope

把 Wave 04 新冻结的 CP/RF 映射到真实 test tree，删除已知过期断言，并区分 behavior proof、source-wiring proof 与真实 Chrome gate。生产源码不在本 Wave 修改。

## Evidence / Exact Binding

| TDD proof | Executable asset | Proof class |
|---|---|---|
| CP-EXE-BR-43 characterData | `packages/execution-browser-extension/tests/page-observation-scheduler.test.ts` | behavior/pure contract |
| CP-EXE-BR-44 10s bottom watchdog | `packages/execution-browser-extension/tests/page-permission-watchdog.test.ts` | behavior/pure contract；真实 SAME_SCENE 仍属 Chrome gate |
| CP-EXE-BR-45 receiver recovery | `packages/execution-browser-extension/tests/page-reality-recovery.test.ts` | reinjection helper behavior + background source wiring；recurring timer behavior carry Wave 06 |
| CP-EXE-BR-46 transient classification retry | `packages/execution-browser-extension/tests/chatgpt-carrier-permission.test.ts` | behavior/pure policy |
| CP-EXE-BR-47 semantic allow fallback | `packages/execution-browser-extension/tests/chatgpt-carrier-permission.test.ts` + `carrier-permission-lifecycle.test.ts` | parser + lifecycle behavior |
| CP-EXE-BR-48 action observability | `packages/execution-browser-extension/tests/permission-action-observability.test.ts` | **source-wiring only**；logger emit behavior carry Wave 06 |
| CP-HOST-22 slugged URL | `packages/platform-host/tests/browser-permission-policy.test.ts` | behavior/pure policy |
| CP-HOST-23 role/version mismatch | `packages/platform-host/tests/browser-permission-policy.test.ts` | behavior/pure policy；durable role reload integration carry Wave 06/14 |

## Findings / Changes Applied

### W05-F01｜WRONG｜Dev/Test journey tests仍要求 `localDev consequential=true`

`agent-controller-dev` 与 `agent-test-ops` 两份 CP-08 均与 shipped OpenAPI/SDD 冲突，会在真实 schema 已正确时产生假 RED。已改成 Repomix/LocalDev/CodeGraph 三个 Direct Tool operation 全部显式 false，并注明该 metadata 不是本机 Effect gate。

### W05-F02｜TRACEABILITY｜新 TDD proof 已存在实现但仍沿用旧 CP 编号

characterData、watchdog、receiver recovery、transient retry、generic allow lifecycle 等已有 executable tests。已把测试名重绑到 CP-43..47，避免后续误判“设计有、测试缺”。

### W05-F03｜MISSING NEGATIVE CASE｜slug URL policy 缺 wrong-worker/hash 与 version mismatch 明确反例

Host policy test 已补：真实 slugged URL允许；wrong role/worker/query/hash 拒绝；Role validation identity/version drift 返回 `ROLE_VALIDATION_MISMATCH`；当前一致 facts 恢复 AUTO_ALLOW。

### W05-F04｜PARTIAL PROOF｜recurring background recovery 仍主要靠 source regex

`recoverMissingContentReceiver` 的 inject-once/reobserve/fail-closed 是行为测试；但 `setInterval + in-flight dedupe + recoverObservations` production wiring 目前仍是读 `background.ts` 的 regex proof。该测试已明确命名 `source wiring`，不再冒充完整 CP-45 runtime behavior。Wave 06 建 testability seam 后补行为 proof。

### W05-F05｜PARTIAL PROOF｜Permission action operation log仍是 source regex

`permission-action-observability.test.ts` 只能证明生产源码存在 `PERMISSION_ACTION/DISPATCHED/STARTED/UNKNOWN` wiring，不能证明 command success/failure 时 logger 真正收到正确 event。已显式标为 source-wiring proof；Wave 06 补 injectable behavior seam。

### W05-F06｜VALID｜Task/Gateway executable surface未发现同类 consequential drift

Gateway 已有 `action-consequential-all-false.test.ts` 和 worker-turn alignment proof。Task reopen/catch-up/same-worker TDD也已有 owner/integration tests；本 Wave 不重复制造同义测试。

## Verification

必须真实执行本 Wave 修改的 9 个 test files；不能以 grep 代替。另执行 `git diff --check`。

## Residual / Carry Forward

Wave 06 只处理两个由本 Wave 机械证明的 testability gap：
1. recurring Background page-reality recovery 的 timer/in-flight behavior seam；
2. Permission semantic action dispatch operation-log emit 的 success/failure behavior seam。

Wave 06 同时反查这些 tests 是否命中真实 production path，避免为测试另建未使用实现。CP-EXE-BR-49 仍必须由真实 Chrome SAME_SCENE evidence关闭，不能自动化自证。

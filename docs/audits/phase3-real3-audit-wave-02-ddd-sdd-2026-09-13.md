# Phase 3 / Real-3 Audit｜Wave 02｜DDD → SDD 一致性

日期：2026-09-13
状态：DONE

## Scope

以 Wave 01 冻结的 Domain ownership 为上游，校准跨域 Journey / Platform Host composition / Execution BC 的当前技术落点；只处理已被当前源码与 Real-3 owner facts机械证明的漂移。

## Evidence

- `PLATFORM-DOC-01-04` 当前 Task Journey / Carrier / Observer 组合。
- `PLATFORM-HOST-COMPOSITION-ROOT` 当前 composition boundary。
- `EXECUTION-BC-README` 与 Execution charter。
- `task-orchestration` reopen 实现：failed/succeeded Node reopen 后 `runNo + 1`，清 run-local `node.workerRef`，TaskRoleBinding 保留。
- `execution-browser-extension/extension/runtime/observer-recovery-controller.ts`：生产组合 `createSystemObserver`，持久化 carry-forward assessment，并调用 Host 的 `system.view/system.drilldown/system.reason`。
- `permission-controller.ts` + `carrier-permission-lifecycle.ts`：`AUTO_ALLOW` 只自动选择页面存在的 `allowAlways`，否则 `allow`；`allowOnce` 仅人工 Attention。
- 三个 Agent OpenAPI：所有 operation 显式 `x-openai-isConsequential: false`。

## Findings / Changes Applied

### W02-F01｜WRONG｜Reopen “same workerRef” 混淆 Task binding 与 run-local Node binding

旧 Journey 写法容易理解成 `node.workerRef` 在 reopen 时原样保留；真实 Task owner 会结束旧 run、将 Node 置 READY、`runNo + 1` 并清空 run-local workerRef，再由 TaskRoleBinding 解析并唤醒同一个 Conversation。

已改为明确区分：**同一 TaskRoleBinding Worker/Conversation 保留；run-local node.workerRef 在新 run START 前重新绑定。**

### W02-F02｜STALE｜Permission 被描述成 ordinary 主链依赖 Always Allow

当前 published Action metadata 全为 nonconsequential，ordinary Action 不应依赖 Permission；Permission surface 只作为 legacy/unexpected/recovery reality。

已改为：ordinary path 显式 `x-openai-isConsequential:false`；若仍出现 Permission，Carrier 才 deterministic classify；可信 `AUTO_ALLOW` 只选择当前页面真实可用的 `allowAlways`/`allow`，未知或只有 `allowOnce` 时进入人工 Attention。

### W02-F03｜AMBIGUOUS→FIXED｜System Observer 运行位置写成“若仍部署于 Extension”

当前生产源码已确定由 Extension `observer-recovery-controller` 组合 System Observer；Host 只提供 bounded owner views/drilldown/reason application endpoints。

已把 topology 写死为当前真实结构，并明确 assessment persistence 是派生诊断状态，不转移业务 owner truth，也不占 Task progression/recovery single-flight。

### W02-F04｜WRONG｜Execution BC 把 GPT-facing Local Tool executor 写成统一由 Execution Runtime 调度

这与 Execution charter 和当前 Direct Tool lane 冲突。

已改为：只有 Browser/Carrier 等 durable effect/internal executor 进入 Execution Runtime；Repomix/Local Dev/CodeGraph 走 Extension Local Tool lane → execution-local，直接回当前 Worker，不创建 executionRef、不进入 Execution Runtime lifecycle。

## Verification

- Journey 必须同时出现 TaskRoleBinding reuse 与 run-local workerRef rebind 语义。
- Permission 主链必须出现 `x-openai-isConsequential: false`，且不得再写 ordinary path 依赖预配置 Always Allow。
- Platform Host composition 必须明确当前 System Observer application 位于 Extension。
- Execution BC 不得再出现“Browser/Local executors 由 Execution Runtime 统一调度”。
- `git diff --check` 必须 PASS。

## Residual / Carry Forward

- Wave 03 继续审 Task/Node/Observer/Permission/Recovery SDD 完整性，尤其 restart、UNKNOWN、durable handoff、Attention occurrence identity。
- Wave 04/05 处理已发现的 Test/Ops `localDev consequential=true` 旧测试断言及其它 TDD/test drift。
- Wave 10/13 再审 Permission 行为与 action-dispatch/released 日志是否形成完整运行证据链。

# Phase 3 / Real-3 Audit｜Wave 01｜DDD / 顶层领域模型

日期：2026-09-13
状态：DONE
范围：五领域 ownership、顶层边界、Deployment domain index 与 Real-3 已验证事实的反向校准。

## Scope

本 Wave 只审 DDD / Domain index / top-level ownership，不提前修改后续 SDD、TDD 或测试实现。结构发现使用当前源码 CodeGraph；领域语义使用 `spec/` canonical 文档与 Repomix exact snapshot；Real-3 终态使用 Task Owner 持久化事实作为校准证据。

## Evidence

- `spec/README.md`：`spec/` 为唯一当前实施规范真源。
- `spec/IMPLEMENTATION-BASELINE.md` 与五领域 `01-领域` / README。
- `PLATFORM-DOC-01-01`、`PLATFORM-DOC-01-02`、`PLATFORM-DOC-01-04`。
- 当前源码结构：Task owner、Agent Role/Worker semantics、Platform Host composition、Browser Extension Carrier/Permission、Execution Runtime。
- 三个 Agent 当前 OpenAPI：所有 operation 均显式 `x-openai-isConsequential: false`。
- Real-3 owner facts：Task `task-real3-final-autowake-20260912 = SUCCEEDED v11`；Test `runNo=2`；REOPEN 复用原 Task-bound Test Worker。

## Findings

### W01-F01｜STALE｜Deployment README 把历史版本写成“当前 Final Freeze”

2026-09-01 freeze 中记录的 package versions 已被后续 Real-3 与 patch release 超越；继续把它们放在 normative domain index 中称为“当前发布线”会制造版本第二真源。

处理：删除“当前发布线”表述；保留 freeze 文件作为历史证据，并明确当前版本只认 package manifest、Workspace lockfile、Module status 与 materialized/runtime reality。

### W01-F02｜STALE｜`Always Allow target configuration` 被误写成 Deployment readiness 配置

当前三个 Custom GPT Action schema 均已显式 `x-openai-isConsequential: false`，当前 Agent setup 代码验证 published material / Role registration / Gateway / Carrier reality，并不存在以 `Always Allow` 作为 setup truth 的配置事实。

处理：Deployment normative index 改为“所有 operation 显式 nonconsequential；unexpected Permission 是 Browser Carrier mechanical gate/recovery”，禁止把 `Always Allow` 当 Role READY / setup / approval truth。

### W01-F03｜VALID｜五领域 ownership 未发现需要重建的第六领域

Task 继续拥有 Task/Node/TaskRoleBinding/TaskDocument；Agent 拥有 Role/Worker identity semantics 与 Collaboration；Execution 拥有 Browser/Carrier durable effect；Model 只做认知计算；Deployment 只做 Module governance。`platform-host`、Gateway、Observer、Extension 均保持 application/composition/adapter 身份。

### W01-F04｜VALID｜TaskRoleBinding / REOPEN 领域语义与 Real-3 一致

DDD 已明确 `reopenNode` 只清 run-level workerRef，不清 TaskRoleBinding，新 run 必须重新解析同一 Task-bound Worker。Real-3 run 2 的 owner facts实际复用了原 Test worker，因此该领域不变量无需修改。

### W01-F05｜VALID｜WAITING / FAILED / Recovery 分界与 Real-3 一致

DDD 已区分业务 WAITING、可恢复的 confirmed run FAILED 与 Effect/transport UNKNOWN。Real-3 的 Repomix owner 故障被 Worker 正式 `failNode(retryable=true)`，随后显式 REOPEN 新 run，符合当前领域语义；不把 FAILED 收窄成业务失败。

## Changes Applied

- 更新 `spec/部署领域/README.md`：去掉过期 current release snapshot；把 freeze 版本降回历史证据。
- 更新 Carrier/Role READY 摘要：删除 `Always Allow target configuration` 作为 Deployment truth，明确 nonconsequential Action schema + Carrier fallback 分层。
- 未改五领域模型、Task state machine 或任何生产源码。

## Verification

- 新 Deployment index 不再出现“当前 Final Freeze”或 `Always Allow target configuration`。
- 明确包含 `x-openai-isConsequential: false` 与 Permission ownership 边界。
- `git diff --check` 必须 PASS。

## Residual / Carry Forward

以下已发现但按审计顺序不在 Wave 01 提前修改：

1. `PLATFORM-DOC-01-04` 仍把 trusted Permission fallback 写成“自动 Always Allow”；Wave 02 检查其是否应改成“选择当前页面可用的受信任 allow variant”，并明确 ordinary nonconsequential Action 不应依赖 Permission 主链。
2. `PLATFORM-HOST-COMPOSITION-ROOT` 使用“System Observer（若仍部署于 Extension）”条件句；当前源码 `execution-browser-extension/src/system-observer.ts` 已有确定实现，Wave 02/07 校准 runtime topology wording。
3. `packages/agent-test-ops/tests/journey-native-capability-alignment.test.ts` 仍断言 `localDev.x-openai-isConsequential === true`，与当前 schema 冲突；留到 Wave 04/05 按 SDD→TDD→test 顺序整改。
4. `spec/` 根部历史架构裁决记录仍含大量早期 Always Allow 语义；Wave 19 依据 lifecycle/provenance 规则决定保留为历史证据、降权或剔除，不能让其冒充 canonical current truth。

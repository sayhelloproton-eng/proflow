# Phase 3 / Real-3 Audit｜Wave 07｜源码架构与模块边界

日期：2026-09-13
状态：DONE（以 frozen-decision targeted verify receipt 为准）

## Scope

审计当前 package / Module / service / process / deployment unit ownership 与 dependency direction，重点验证：

- Task Orchestration 是 Task state owner；
- Agent Runtime 只拥有 Role / credential / Collaboration durable truth；
- Browser Extension 只拥有 browser/carrier reality 与 Local Tool bridge；
- Execution Runtime 只拥有 Execution durable lifecycle，不反向拥有 Task/Agent truth；
- Platform Host 是 composition/transport root，不成为第二业务 owner；
- Agent Gateway 是 GPT Actions ingress / anti-corruption layer，不成为第二 runtime。

## Evidence

当前 `proflow.module.json` 与 `package.json`：

- `task-orchestration`：library，`requires=[]`；
- `agent-runtime`：library，仅 requires `task-orchestration`；
- `execution-browser-extension`：provides `local-tool-bridge + execution-browser-executor + custom-gpt-web-provisioning`，requires `execution-local + task-orchestration + agent-runtime`，不 requires `execution`；
- `execution-runtime`：service，仅 requires `execution-browser-executor + execution-local`，不 requires Task/Agent/Host；
- `platform-host`：service，requires `local-tool-bridge + task-orchestration + agent-runtime`；Execution/Model service 只经 transport，不作为 Host-owned runtime；
- `agent-gateway`：service，requires Agent/Task/Host/Public Ingress contracts，生产 package 不直接组合 Owner runtime。

当前 filesystem 还机械确认 `execution-browser-extension` 已不存在旧 `task-observer` 源文件；CodeGraph 对该历史 symbol 的命中属于 stale index，不作为当前实现事实。

## Findings / Changes Applied

### W07-F01｜VALID｜当前 owner dependency direction 已与冻结架构一致

未发现需要改生产源码的 owner 反转：Task 无上游业务依赖；Agent 只依赖 Task；Execution Runtime 不依赖 Task/Agent/Host；Browser Extension 不依赖 Execution Runtime contract；Host 只组合 owner public surfaces / local bridge；Gateway 保持 transport ingress。

### W07-F02｜MISSING PROOF → CLOSED｜缺当前真实 descriptor 全图行为证明

原有 `deployment-conformance` 能检测 package import cycle，Platform CLI lifecycle tests 能证明 generic dependency ordering，但都没有把**当前仓库真实 `proflow.module.json`**交给真实 `buildDependencyGraph()` 并锁定关键 owner direction。

新增：

`packages/platform-cli/tests/current-module-graph.test.ts`

该测试动态读取当前 `packages/*/proflow.module.json`，使用 production `buildDependencyGraph()`：

1. 当前完整 capability graph 必须无环并成功得到完整 order；
2. Task/Agent/Browser/Execution/Host/Gateway 的关键 contract edge 必须与当前 owner 模型一致；
3. Browser Extension 不得恢复 `execution` dependency；
4. Execution Runtime 不得恢复 Task/Agent/Host dependency；
5. Platform Host 不得声明 `execution` business dependency；
6. 受控反例向 Agent Runtime 重新加入 `execution` requires 时，真实 graph builder 必须报 `DEPENDENCY_CYCLE`，机械复现 `agent → execution → browser → agent` 禁止环。

这不是源码字符串 grep，而是当前真实 descriptor + production graph implementation 的 executable behavior proof。

## Verification

- `node --test packages/platform-cli/tests/current-module-graph.test.ts`
- `pnpm --filter @tomflow/proflow-platform-cli typecheck`
- `git diff --check`

## Residual

Wave 07 未发现需要保留的架构 blocker。运行时 state/restart/UNKNOWN 的细节不在本 Wave 扩大处理，顺序进入 Wave 08｜状态机与恢复语义。

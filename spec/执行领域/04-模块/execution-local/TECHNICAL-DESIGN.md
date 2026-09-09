---
docId: EXECUTION-EXECUTION-LOCAL-TECH-DESIGN
title: 05 · execution-local 详细技术方案
docType: module-design
authority: normative
lifecycle: active
domain: execution
moduleRef: execution-local
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- AGENT-DOC-02-05
- EXECUTION-DOC-02-01
---

# 05 · execution-local 详细技术方案

## 1. 定位

`@tomflow/proflow-execution-local` 是 Browser Extension Local Tool lane 后面的**本机工具实现扩展包**。它不是独立公网服务，不是 MCP Server，也不是 GPT-facing Execution Runtime。

正式调用：

```text
Action → Gateway → ProFlow API → Browser Extension Local Tool lane
→ authenticated local-tool bridge → execution-local → macOS
```

包名位于 Execution 领域不代表调用必须进入 `execution-runtime`。旧 durable Execution 若仍有内部 caller，可以复用底层 primitive，但 Local Tools 不创建 Execution Record/ExecutionRef。

## 2. 包内结构

```text
execution-local/
├─ primitives/                # fs/path/search/process/command/git 等本机基础能力；不依赖 Execution DTO
├─ local-dev/                 # Direct Tool adapter：read/list/search/mutate/run/process
├─ repomix/                   # Direct Tool provider：pack/grep/read
├─ codegraph/                 # Direct Tool provider：explore
└─ execution-adapter/         # 仅内部 durable Execution 使用；把 primitives 映射到旧 Execution contract
```

当前 `createLocalExecutor()` 是 Execution-shaped API，依赖 `ExecuteCapabilityRequest/ExecutionEvidence/onEffectStarted/reconcile`。重构时不得把它直接换名或再薄包一层作为 Direct Tool API；必须先把可复用本机逻辑下沉到不依赖 Execution lifecycle 的 primitives/provider ports，再由 Direct Tool adapter 与 internal Execution adapter 分别消费。

因此同一物理 package 可以复用代码，但两条入口的 DTO、readiness、result/error/handle 与 lifecycle 必须独立。不得让 Direct Tool adapter import `ExecuteCapabilityRequest`、`ExecutionRef`、`ExecutionRecord` 或调用 `executeCapability()`。

不再把 File/Git/Process/Shell/Project/Quality 作为 GPT-facing Capability Family 平铺。

## 3. Local Dev

GPT-facing operation family 固定：

```text
read
list
search
mutate
run
process
```

### read
单/多文件当前磁盘读取；可返回必要 size/hash/mtime metadata。不得承担全仓上下文聚合。

### list
目录与基本 metadata。

### search
仅窄域、实时 filename/literal/regex 查找，用于刚修改后的机械核验等。广域代码上下文与仓库理解交给 Repomix。

### mutate
`create/write/edit/mkdir/move/delete` 作为精确 discriminator；必须受 workspace/path/symlink/protected-area guard。

### run
one-shot command。Git status/diff/log/commit、pnpm/npm install、test/build/lint/typecheck 等不再建立独立 GPT operation family；统一使用 argv/cwd/env 受控的 `run`。

### process
```text
list / ports / status / start / read / input / stop
```

支持发现本机已启动进程、监听端口/PID/process name；managed process 返回 tool-native `processRef`。`processRef` 不是 ExecutionRef。

## 4. Repomix

GPT-facing：`pack / grep / read`。

优先依赖官方 `repomix` Node library；CLI 只作已证明需要的 fallback。语义对齐成熟的 `pack_codebase / grep_repomix_output / read_repomix_output`，但不启动 MCP transport。

Repomix 负责“读懂仓库/构建广域上下文”，Local Dev 不复制这部分能力。

## 5. CodeGraph

GPT-facing v1 只暴露 `explore`。内部可使用官方 `@colbymchenry/codegraph` library 的 callers/callees/dependency/impact 等能力组织结构化结果；CLI/binary 只作必要 fallback。

## 6. Local Dev implementation source

Local Dev 以 DesktopCommanderMCP 成熟的 file/search/process 实现和语义为上游参考，**去掉 MCP stdio/server/tools-list/tools-call transport**，裁掉与 Repomix 重叠的广域读取，只保留 ProFlow 六个 operation family。

不得 deep-import 一个没有稳定 public API 的 Desktop Commander 私有 dist 路径作为长期 contract；实现可合法复用/移植所需核心逻辑并由 ProFlow 自己拥有 adapter/contract。

## 7. Workspace / path safety

Workspace root 由部署事实绑定，GPT 不提交任意 projectRoot 扩权。路径 canonicalize 后检查真实目标；symlink/`..`/absolute 指向默认范围外时先按 §14 提示用户后执行，无需越界批准；`.proflow` credential/state protected area 默认拒绝普通 Tool mutation/read。

## 8. Command / process safety

- 优先 argv + cwd + controlled env，避免无必要 shell string；
- env 最小继承，secret/redaction；
- timeout/maxOutput/process tree cleanup；
- system-wide destructive/elevation 默认 DENY；
- `run/process` 的真实副作用仍受 Role×Tool×Operation、Extension Effect Gate 和 execution-local runtime safety。

## 9. UNKNOWN / no blind replay

Tool mutation/command 在 transport 中断后无法确认结果时返回 `TOOL_RESULT_UNKNOWN`。Agent 必须用 `read/search/process.status/process.ports/git diff` 等观察现实后再决定；不得因为缺少 Execution Record 就自动 replay。

## 10. Output / handles

同步结果必须 bounded 并满足 GPT Action `<100k`。大结果优先使用 Tool 原生 handle（如 Repomix outputId、Local Dev processRef/search handle）或 File Bridge；不得新增 `executionRef → getExecution/readExecutionOutput` 工具轮询。

## 11. Dependency direction

`execution-local` 不依赖 Browser Extension、Task、Agent、platform-host 或 Model 业务模块。它只暴露 typed local tool implementation ports；Browser Extension local-tool bridge 调用它。

## 12. Real integration gate

candidate 前必须真实证明：
- Repomix pack→grep/read；
- CodeGraph explore；
- Local Dev read + mutate + run + process.list/ports；
- 全部经 Extension Local Tool lane 到真实 macOS；
- 不存在 MCP runtime 或 Host/API bypass。

## 13. 最小 primitive 与隔离单位

仅提取已有真实双 caller 的 path resolution、bounded file I/O、argv invocation、process output/cleanup 等函数；Repomix/CodeGraph adapter 不必套统一 provider superclass、registry 或 middleware pipeline。Direct Tool public subpath 与 internal execution-adapter public subpath 分开导出；前者的传递 import 图不得到达 ExecutionEvidence/ExecuteCapabilityRequest/ExecutionRecord/ExecutionRef、Execution store 或 admission hook；不能只检查入口文件字符串。

官方 library 在 Extension module 管理的 Provider child 内加载，阻塞计算不进入 Node bridge control loop。独立 child 是运行隔离实现，不是新 Service/Domain。package root 不通过 barrel eagerly 初始化 internal Execution adapter。

## 14. Trusted local command 与显式范围提示

Local Dev 使用 trusted local developer command 模型。Workspace 是 server-bound 默认操作范围，不是 OS sandbox。ProFlow 能明确识别的外部 path/cwd、跨 Workspace move/copy、另一个 repo 或显式外部文件参数，必须在 Effect 前由 Extension 向用户明确提示规范化越界目标；提示后继续执行，不等待批准，也不因缺少越界批准而拒绝。不能静默扩大默认范围。

获准的 pnpm/npm test/build/install、git、node/python、repo script/lifecycle/hook 继承当前 macOS 用户权限。平台不承诺阻止脚本内部访问 Workspace 外部；不要求 container、VM、mandatory sandbox 或新增 Approval Runtime。认证 Role×Tool×Operation、canonical path/symlink 检测、受保护 credential、env redaction、deadline、managed processRef、generation/digest 校验与 UNKNOWN no-blind-replay 继续有效。

越界提示关联当前 commandId/generation、Role、Workspace、Tool/operation、完整参数摘要和规范化越界目标；参数/目标变化时提示实际目标。提示无需用户确认，不引入 approved 字段或越界批准状态。Extension Effect Gate 仍校验身份、参数和 deadline；过期 command 不重启，UNKNOWN 不盲重放。提示不创建 Execution Record，也不赋予任意 PID 控制权。明确危险操作的独立确认规则继续有效。

## 15. Provider Reality 必须核实的差异

Repomix 官方 library 可复用，但 MCP 的 outputId/grep/read session 不等于 npm public API 自带这些语义；adapter 只保存 bounded 本机 pack output、hash/生成时间及 Role/Workspace-scoped handle，再实现 grep/read。不得 deep-import MCP server/session 来借用句柄。pack snapshot 不宣称当前磁盘实时真值。

CodeGraph 采用公开 CodeGraph class 或 CLI explore；index 初始化、更新、锁、关闭与结果 freshness 必须在 Provider child 中明确。mutate 后 graph 可能 stale，返回 freshness/observed revision；需要当前磁盘确认时用 Local Dev。索引失败只让 CodeGraph unavailable，不把全局 workspace readiness 拉低。

固定版本、license、Node native library 与 macOS x86_64 实际运行能力必须在 Provider Reality Gate 验证；官方存在 API 只证明集成方向可行，不等于本机 smoke PASS。DesktopCommanderMCP 仅作为合法源码参考，不引入其 MCP transport 或私有 dist contract。

参考：[Repomix library](https://repomix.com/guide/development/using-repomix-as-a-library)、[CodeGraph library](https://github.com/colbymchenry/codegraph#library-usage)。

## 16. 设计门已关闭

用户于 2026-09-09 明确采用 trusted local command 模型；OS 强隔离不是产品承诺，也不再是 Real-3 实现前置。F9 已关闭；DESIGN_GATE=PASS，IMPLEMENTATION_GO=YES。Provider 实测和 executable evidence 随真实实现推进，不冒充已完成 Real-3。
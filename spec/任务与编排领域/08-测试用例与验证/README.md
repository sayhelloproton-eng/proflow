# Task & Orchestration Wave 1 验证证据

本目录是开发后 Evidence，不修改 `07-测试计划/` 的冻结语义。

## 范围

- `@tomflow/proflow-task-orchestration`
- `@tomflow/proflow-task-store-sqlite`
- `@tomflow/proflow-task-migration-runner`
- 17 个 Critical Proof
- Foundation C1/C2/C3 与 repository architecture gate

产品语义来源是当前 `spec/任务与编排领域/**` 与 `spec/平台架构与公共约定/**`。治理 ZIP 仅用于本轮目标和 Evidence Matrix；其 SHA-256 为 `6c25b72f45bf4c9da19ee44b45661c798b8fafba120943bcb3ac9587ca91aa3e`，没有提交到仓库。

## TDD 事实

Observed RED 在实现文件出现前执行：

```text
command: pnpm test
tests: 26
pass: 21
fail: 5
```

失败来自三个目标模块尚无 package/source：architecture 找不到 package manifest，Node ESM 找不到三个新包和 `task-orchestration/src/index.ts`。既有 Foundation 测试仍通过，因此不是损坏 fixture 或运行环境造成的伪 RED。

Minimal GREEN 由三个正式模块、其测试及必要 workspace wiring 构成；没有实现其他业务 Domain。

## 最终入口

- `CRITICAL-PROOF-EVIDENCE.json`：17 个 proof 的 Source/Test/Evidence/Result 绑定。
- `ACTUAL-RESULT.md`：真实 DB、事务、版本/幂等、文档/Git、迁移、恢复与门禁观测。

真实 Agent Worker provisioning、Execution Browser 生命周期、Gateway transport、platform-host composition 和 Task↔Agent/Execution runtime E2E 均为 `DEFERRED_TO_CROSS_DOMAIN`，本轮没有 Fake PASS。

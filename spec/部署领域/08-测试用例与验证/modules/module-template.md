# module-template 实施证据

## Source Test Plan

`spec/部署领域/07-测试计划/modules/module-template.md`

## Critical Proof 与 executable test

| Critical Proof | Executable test | Evidence |
|---|---|---|
| CP-DPL-TPL-01 | `module-template.test.ts`：真实临时目录生成六种 profile 并检查特异文件 | 六 profile 目录树与 descriptor kind |
| CP-DPL-TPL-02 | `module-template.test.ts`：逐 profile 检查 metadata/README/deployment/verification/conformance 文件及 lifecycle | 最小骨架与无虚假 start/stop |
| CP-DPL-TPL-03 | `module-template.test.ts`：对六个生成包逐一执行 TypeScript 7.0.2 `tsc --noEmit` | 六次真实 typecheck PASS、no-any source check |
| CP-DPL-TPL-04 | `module-template.test.ts`：兼容升级无需迁移；contract incompatibility 要求 migration + re-conformance | migration assessment result |

## Observed RED

测试先于实现创建。首次执行：

```text
pnpm --filter @tomflow/proflow-module-template test
ERR_MODULE_NOT_FOUND: packages/module-template/src/index.ts
tests 1; pass 0; fail 1; skipped 0; todo 0; exit 1
```

这是生成行为尚未实现造成的 RED。后续首次 CP-03 运行还发现测试定位 `tsc` 时使用了 package cwd；改为从测试文件位置解析仓库固定工具后，真实生成包 typecheck 才成为可观察 Gate。

## Minimal GREEN 与 Refactor

实现单一 Template Package，通过 profile map 生成六种 Kind 的共同最小骨架及特异职责；生成前由 module-contract runtime schema 校验 descriptor。使用真实 `mkdtemp` 文件系统，不 Mock 写入结果。

## Command / Actual Result

```text
pnpm --filter @tomflow/proflow-module-template test
tests 4; pass 4; fail 0; skipped 0; todo 0

generated profiles                 6/6
generated package tsc --noEmit     6/6 PASS
pnpm check                         PASS
```

## Evidence

- Generator：`packages/module-template/src/index.ts`。
- Executable tests：`packages/module-template/tests/module-template.test.ts`。
- Real filesystem：macOS temporary directories created by `mkdtemp` and removed after each test。
- Commit：`feat(deployment): implement module template`（本证据随该提交落库）。
- C1/C2/C3：在 `deployment-conformance` 建立后由最终 Bootstrap reconciliation 对真实生成包执行。

## Known limitation

模板只生成最小工程起点，不生成业务领域实现。正式 Conformance 由 owner module `deployment-conformance` 执行，不在模板包内维护第二套 Gate。

# module-contract 实施证据

## Source Test Plan

`spec/部署领域/07-测试计划/modules/module-contract.md`

## Critical Proof 与 executable test

| Critical Proof | Executable test | Evidence |
|---|---|---|
| CP-DPL-CON-01 | `module-contract.test.ts`：完整 descriptor parse 与缺失 verification reject | runtime schema 正/负向结果 |
| CP-DPL-CON-02 | `module-contract.test.ts`：moduleRef/secretRef 与不安全 secret default reject | typed parse/reject |
| CP-DPL-CON-03 | `module-contract.test.ts`：两次 Requirement 查询及查询前后 descriptor 比对 | 无 mutation、返回副本 |
| CP-DPL-CON-04 | `module-contract.test.ts`：library start/stop reject；不可控 external fixture 无虚假 lifecycle | lifecycle validation |
| CP-DPL-CON-05 | `module-contract.test.ts`：新增 provide compatible；移除 provide breaking | compatibility result |

## Observed RED

测试先于实现创建。首次执行：

```text
pnpm --filter @tomflow/proflow-module-contract test
ERR_MODULE_NOT_FOUND: packages/module-contract/src/index.ts
tests 1; pass 0; fail 1; skipped 0; todo 0; exit 1
```

这是目标行为尚未实现造成的 RED，不是损坏 fixture 或环境替代。

## Minimal GREEN 与 Refactor

以 Zod 4 单一 runtime schema 推导公开类型，实现 `unknown → parse → typed value`、ConfigSlot 组合约束、library lifecycle 约束、Requirement 纯查询和 compatibility 判断。首次 GREEN 尝试暴露 camelCase ConfigSlot key 边界，修正后保持规范示例兼容。

## Command / Actual Result

```text
pnpm --filter @tomflow/proflow-module-contract test
tests 5; pass 5; fail 0; skipped 0; todo 0

pnpm lint       PASS
pnpm typecheck  PASS
pnpm test       PASS
pnpm check      PASS
```

## Evidence

- Runtime dependency：`zod@4.1.12`，exact version。
- Test file：`packages/module-contract/tests/module-contract.test.ts`。
- Runtime schema/type source：`packages/module-contract/src/index.ts`。
- Commit：`14189420af87bd9633282f90d8415f8d529d5954`。
- Bootstrap reconciliation：自身 descriptor、C1/C2/C3 与六 profile 闭环测试 PASS。

## Known limitation

本模块仅定义与验证 Module 治理合同；不执行 Deployment、业务领域行为或真实 External Resource E2E。

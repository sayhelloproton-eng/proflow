# deployment-conformance 实施证据

## Source Test Plan

`spec/部署领域/07-测试计划/modules/deployment-conformance.md`

## Critical Proof 与 executable test

| Critical Proof | Executable test | Evidence |
|---|---|---|
| CP-DPL-CONF-01 | `deployment-conformance.test.ts`：合法 descriptor PASS；缺字段、非法版本、secret config、library lifecycle、空 verification FAIL | C1 structured results |
| CP-DPL-CONF-02 | `deployment-conformance.test.ts`：真实生成 package PASS；version mismatch 与 missing export entry FAIL | C2 package inspection |
| CP-DPL-CONF-03 | `deployment-conformance.test.ts`：只调用声明 lifecycle；fake AVAILABLE 与 doctor effect FAIL | C3 structured results；undeclared call count 0 |
| CP-DPL-CONF-04 | `deployment-conformance.test.ts`：合法 GPT/File Bridge profile PASS；consequential、Actions/Apps、45s/100k、file limits、relay、SSRF、media、typed errors 的逐项非法 fixture FAIL | GPT Actions/File Bridge structured results |

## Observed RED

测试先于实现创建。首次执行：

```text
pnpm --filter @tomflow/proflow-deployment-conformance test
ERR_MODULE_NOT_FOUND: packages/deployment-conformance/src/index.ts
tests 1; pass 0; fail 1; skipped 0; todo 0; exit 1
```

这是 C1/C2/C3/GPT Gate 尚未实现造成的 RED。

## Minimal GREEN 与 Refactor

- C1 消费 module-contract 的同一 runtime schema，不复制 descriptor schema。
- C2 读取真实 package filesystem，检查 metadata/version/exports/entry/adapter/conformance config。
- C3 只执行 descriptor 已声明 primitive，检查结构化 Result、preflight/doctor 副作用和 External availability evidence。
- GPT/File Bridge Gate 覆盖 explicit consequential、role-scoped operation、File Bridge 固定限制、TLS/443 与 SSRF、relay header/token/scope/TTL、最终序列化预算、typed errors、真实 HTTP 状态和禁止 effect 后 blind replay。

## Command / Actual Result

```text
pnpm --filter @tomflow/proflow-deployment-conformance test
tests 4; pass 4; fail 0; skipped 0; todo 0

pnpm check
tests 13; pass 13; fail 0; skipped 0; todo 0
```

## Evidence

- Gate implementation：`packages/deployment-conformance/src/index.ts`。
- Machine CLI：`packages/deployment-conformance/src/cli.ts`。
- Executable tests：`packages/deployment-conformance/tests/deployment-conformance.test.ts`。
- Commit：`feat(deployment): implement deployment conformance`（本证据随该提交落库）。

## Known limitation

可控 fake resource 仅证明 adapter/conformance 合同，不证明真实 Carrier、Chrome 或外部账号可用性；真实 External E2E 保留给后续 Deployment Gate。

# ProFlow Foundation Closure 实施证据

## Source Spec / Test Plan

- `spec/部署领域/04-模块/module-contract/TECHNICAL-DESIGN.md`
- `spec/部署领域/04-模块/module-template/TECHNICAL-DESIGN.md`
- `spec/部署领域/04-模块/deployment-conformance/TECHNICAL-DESIGN.md`
- `spec/部署领域/07-测试计划/modules/module-contract.md`
- `spec/部署领域/07-测试计划/modules/module-template.md`
- `spec/部署领域/07-测试计划/modules/deployment-conformance.md`
- `spec/平台架构与公共约定/01-架构/01-领域边界与依赖约定.md`
- `spec/平台架构与公共约定/02-契约/03-版本与兼容性约定.md`
- `spec/平台架构与公共约定/03-工程/01-包模块与代码边界约定.md`
- `spec/平台架构与公共约定/03-工程/02-测试与验收约定.md`
- `spec/平台架构与公共约定/06-测试计划/04-证据与停止门.md`

施工治理包只用于执行调度，SHA-256 为
`36cf67370503422a4af5e157c7156c131d3bf7bbaac95c2c88c808e580824f82`，未复制或提交到仓库。

## P1 closure matrix

| Audit item | Executable proof | Result |
|---|---|---|
| P1-1 六种 Profile 职责 | `profile-hardening.test.ts`；逐一加载并执行 generated adapter；service restart、CLI JSON、browser status/verify、agent ACTION_REQUIRED、external UNKNOWN availability | PASS |
| P1-2 Generated package 自有 C3 adapter | `bootstrap-reconciliation.test.ts`、`foundation-hardening.test.ts`；从真实临时目录加载生成物 adapter，破坏 adapter 后 C3 FAIL | PASS |
| P1-3 完整 C1/C2 | `deployment-conformance.test.ts`、`foundation-hardening.test.ts`；覆盖 runtime schema、版本/冲突、Kind/lifecycle、metadata/exports/entry、structured CLI、secret、generated provenance、C1→C2→C3 顺序 | PASS |
| P1-4 正式 package 命名 | runtime schema、template 和 repository architecture 均强制 `@tomflow/proflow-*`；非法 fixture FAIL | PASS |
| P1-5 Publishability | root 保持 `private: true`；正式 Module 无 `private: true` 且 `publishConfig.access=public`；未执行 publish | PASS |
| P1-6 Compatibility | `compatibility-hardening.test.ts` 覆盖 identity/contract、provides、requires、config、lifecycle、verification、effects、platform range 与 template-only 变化 | PASS |

```text
P0 = 0
P1 = 0
```

## Observed RED

测试在对应实现之前创建。首次真实执行 `pnpm test`：

```text
tests 20
pass 16
fail 4
exit 1
```

失败原因分别为：repository architecture module 尚不存在、`runGeneratedPackageConformance` 尚未导出、`loadGeneratedBehaviorAdapter` 尚未导出，以及 P1-6 compatibility 断言失败。没有用重复运行把失败伪装为 GREEN。

## GREEN / Actual Result

Foundation 实现提交：`f3c6f13bb3327798e5891688c60ae5bec4774ecb`（`fix(deployment): close foundation governance gaps`）。

```text
pnpm lint       PASS
pnpm typecheck  PASS
pnpm test       tests 22; pass 22; fail 0
pnpm architecture
  status PASS
  checked packages 3
  issues 0
pnpm check      PASS
git diff --check PASS
```

六种真实临时生成 package 均执行 strict `tsc --noEmit`，再加载自身 descriptor/adapter，按 C1 → C2 → C3 顺序全部 PASS；故意破坏 C1、C2 或 C3 的 fixture 均在所属 Gate FAIL。

## Architecture / Conformance evidence

`pnpm check` 已包含 `pnpm architecture`。门禁自动发现 `packages/*`，当前机械验证：

- root/private 与正式 Module/public publish metadata；
- `@tomflow/proflow-*` package 命名；
- explicit public exports、禁止 internal/deep import；
- undeclared dependency 与 runtime dependency cycle；
- 禁止 ownerless `common/shared/utils/core` package；
- Module descriptor、C1/C2、generated artifact provenance；
- plaintext secret；
- 动态 import 不得隐藏 dependency。仅带显式注解、且形态严格为本地文件 URL `.href` 的 conformance loader 允许执行；任意其他 computed dynamic import FAIL；
- 新 package 加入后默认进入同一 Gate。

当前审计：

```text
deep/internal cross-package import = 0
undeclared dependency              = 0
dependency cycle                   = 0
dumping-ground package             = 0
plaintext secret                   = 0
legacy mutation                    = 0
business-domain implementation     = 0
normative Spec semantic drift      = 0
```

## Known limitations / future gates

- Task/Agent/Execution/Model 的事实 Owner、跨领域状态写入与 opaque ref 由未来业务 Domain 实现后证明。
- DB/Repository ownership 需要真实持久化实现后验证。
- 跨领域 Integration/E2E 与真实 External Resource acceptance 保留给后续 Wave；fake resource 只证明合同，不证明外部 availability。
- `platform-host`、`platform-cli`、`module-skill` 未在本轮实现。

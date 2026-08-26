---
docId: MODEL-DOMAIN-TODO
title: 模型与推理领域｜Domain TODO
docType: todo-index
authority: operational
lifecycle: active
domain: model-reasoning
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs: []
---

# 模型与推理领域｜Domain TODO

> 这里只保存跨 Module 或 Domain-level Gate。可直接编码的工作下沉到 Module TODO。

## Domain-level Gates

1. Public Contract 与 TypeScript contracts/runtime schema 一一对应。
2. Module Registry 与 package/service/process/deployment unit 实际落位一致。
3. Domain integration tests 通过。
4. 修改 ownership/state/effect/approval/recovery/public contract 时，执行受影响的 cross-domain contract/E2E。
5. `PENDING_SPIKE` 不得成为没有 fallback 的 correctness dependency。
6. 完成项必须回填 verification/evidence，不用“代码已写”代替验收。

## 2026-08-26 当前裁决

| Gate | 状态 | 说明 |
|---|---|---|
| Provider generic boundary | `PASS` | endpoint/protocol/auth/inventory/secret reference 已实现并通过确定性测试 |
| Runtime deployment automation | `PASS` | capability probe、FAST/REASON mapping、inventory drift、runtime freshness、fail-closed 与 lifecycle 已实现 |
| Deterministic package gates | `PASS` | Provider 17/17；Runtime 61/61 且连续三次通过；双包 typecheck/Biome 已通过 |
| Deployment-owned endpoint resolver | `ARCHITECTURE_STOP` | Owner 未裁决；不得在 Model Domain 实现产品/设备 discovery |
| Real external model E2E | `ACTION_REQUIRED` | 尚无机器自动发现且真实可用的 Provider evidence |

`MODEL_DOMAIN_CODE = PASS` 不关闭真实模型 gate。后续 Domain 工作只剩真实 Provider 到位后的 inventory、FAST/REASON、Vision、reasoning、inference、重复 setup 与 server-off recovery 验证；resolver 归属由 Deployment 先行裁决。

## Module TODO

- [model-contracts](../04-模块/model-contracts/TODO.md)
- [model-runtime](../04-模块/model-runtime/TODO.md)

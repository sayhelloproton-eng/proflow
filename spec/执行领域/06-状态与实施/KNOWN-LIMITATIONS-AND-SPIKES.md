---
docId: EXECUTION-LIMITATIONS
title: 执行领域｜待确认项、限制与 Spike
docType: limitations
authority: normative
lifecycle: active
domain: execution
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs: []
---

# 执行领域｜待确认项、限制与 Spike

## 状态规则

```text
TODO = 正确目标和实施方法已经确定，但尚未完成
PENDING_SPIKE = 外部行为或关键假设尚未通过真实验证
KNOWN_LIMITATION = 已知限制，必须有当前 fallback / operator action
FUTURE = 不属于 v1 当前范围
```

任何 `PENDING_SPIKE` 都不得成为没有 fallback 的 correctness dependency。只有真实 E2E/实验通过，并确认不破坏 ownership / contract / recovery 后，才可提升为正式主路径。

## EXE-LIMIT-001｜Browser/Carrier 外部行为不可控
- Type: `KNOWN_LIMITATION`
- Current fallback: `IDLE/BUSY/BLOCKED/UNKNOWN`、permission fallback、Recovery Scan、reality verification。
- Blocks P0: No，只要真实 E2E/fault tests 通过。

## EXE-LIMIT-002｜Multi-Action Worker Turn 的真实 Carrier 证明
- Type: `KNOWN_LIMITATION`（真实目标环境最终 E2E 待执行）
- 架构主路径已冻结：一次 WAKE 对应语义 Worker Turn，同一 Turn 可连续 `0..N` Actions，Browser 不做 per-action scheduler。
- Execution correctness 不依赖 GPT 连续调用次数；若 Turn 因外部原因结束，只在新的 result/reply/trigger 需要时恢复同一 Worker，且 UNKNOWN/已成功 Effect 不得盲重放。

## EXE-FUTURE-003｜Knowledge Access
- Type: `FUTURE`
- v1 不实现 retrieval service；Execution 只保留明确扩展位。

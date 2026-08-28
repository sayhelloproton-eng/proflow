---
docId: MODEL-LIMITATIONS
title: 模型与推理领域｜待确认项、限制与 Spike
docType: limitations
authority: normative
lifecycle: active
domain: model-reasoning
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs: []
---

# 模型与推理领域｜待确认项、限制与 Spike

## 状态规则

```text
TODO = 正确目标和实施方法已经确定，但尚未完成
PENDING_SPIKE = 外部行为或关键假设尚未通过真实验证
KNOWN_LIMITATION = 已知限制，必须有当前 fallback / operator action
FUTURE = 不属于 v1 当前范围
```

任何 `PENDING_SPIKE` 都不得成为没有 fallback 的 correctness dependency。只有真实 E2E/实验通过，并确认不破坏 ownership / contract / recovery 后，才可提升为正式主路径。

## MODEL-LIMIT-001｜Provider Capability 必须实测
- Type: `KNOWN_LIMITATION`
- Provider 声明不能代替真实 capability verification。
- Current fallback: owning Model Module 的 setup/status + package-owned capability verification + Model behavior tests；不满足则 `DEGRADED/UNAVAILABLE`。Platform 不提供 verify/doctor 第二真源。

## MODEL-LIMIT-002｜单 Lane 是 v1 稳定性策略
- Type: `KNOWN_LIMITATION`
- v1 不承诺多模型并行或抢占。
- Current fallback: business/background 两级队列，串行执行。

## MODEL-LIMIT-003｜Provider endpoint resolver 尚无 Deployment owner
- Type: `KNOWN_LIMITATION / ARCHITECTURE_STOP`
- Model Provider 只接受 generic HTTP(S) endpoint 与可选 credential reference；Model Runtime 只消费已验证 inventory/evidence。
- Current fallback: 完整 Platform setup 保持 `ACTION_REQUIRED/BLOCKED`；独立 CLI 显式 URL 只用于诊断或 resolver 输出注入，不得被描述为正常用户流程。
- Stop rule: 不把 Bonjour/DNS-SD、MLXHub、iPhone 或局域网盲扫引入 Model Domain；若需要新增 Module、改变当前 23 模块顺序或放宽边界，先做正式架构裁决。

## MODEL-LIMIT-004｜真实外部模型证据未完成
- Type: `KNOWN_LIMITATION`
- 确定性 fake/local HTTP tests 已通过，但尚未形成当前真实 Provider 的 inventory、FAST/REASON、Vision、reasoning、runtime inference 与 server-off recovery evidence。
- Current fallback: `MODEL_DOMAIN_CODE = PASS` 与 `REAL_EXTERNAL = ACTION_REQUIRED` 并存；不得宣布平台 READY。

## MODEL-FUTURE-005｜并行推理/持久队列
- Type: `FUTURE`
- 只有真实吞吐量需求证明单 Lane 不够时才重新评估。

---
docId: MODEL-DOMAIN-README
title: 模型与推理领域
docType: domain-index
authority: normative
lifecycle: active
domain: model-reasoning
boundedContext: model-reasoning
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs: []
---

# 模型与推理领域

> 模型接入、ReasoningSpec、FAST/REASON/AUTO、Provider capability 与 Runtime Health。本目录同时表达 DDD 领域边界和真实工程实现路径。

## 推荐阅读顺序

1. `01-领域/01-领域宪章与Bounded-Context-Map.md`
2. `01-领域` 其余领域模型/不变量文档
3. `02-契约`
4. `03-流程与数据`
5. `04-模块`
6. `05-质量与部署`
7. `06-状态与实施`

## Modules

- [model-contracts](04-模块/model-contracts/README.md)
- [model-runtime](04-模块/model-runtime/README.md)

## 2026-08-26 当前实施状态

```text
MODEL_PROVIDER_BOUNDARY = PASS
MODEL_RUNTIME_DETERMINISTIC_GATE = PASS
MODEL_DOMAIN_CODE = PASS
REAL_EXTERNAL = ACTION_REQUIRED
```

Provider 的 generic HTTP(S) probe、inventory/auth/secret reference，以及 Runtime 的能力探测、FAST/REASON 映射、drift/freshness、fail-closed 与本地进程生命周期已经进入 main（`47bc8dc`）。这只证明代码与确定性门，不证明当前机器存在可用外部 Provider。

自动 endpoint discovery 的 Deployment owner 与产品交互边界不得反向污染 Model Domain；不得把 Bonjour/DNS-SD、MLXHub/iPhone identity 塞入本领域，也不得要求用户手填机器可发现的 LAN IP 或按模型拆分 URL。当前 Real-3 模型前沿、FAST/THINK 能力验证与未解决问题见平台公共上下文 `09-Real3当前上下文与未解决问题-20260829.md`。

## 文档职责

- `01-领域`：Why、Ownership、Ubiquitous Language、Bounded Context、当前设计不变量。
- `02-契约`：Public Contract、Provides/Requires、跨域 ACL。
- `03-流程与数据`：状态、流程、持久化、并发、幂等、失败恢复。
- `04-模块`：Module → npm package/service/process/deployment unit 技术设计。
- `05-质量与部署`：安全、测试、E2E、实施/停止门、部署 requirements。
- `06-状态与实施`：明确待确认项、PENDING_SPIKE、Known Limitation 与 Domain TODO。

## 实施原则

其他领域只能依赖本领域 Public Contract / logical capability；禁止 direct DB read、internal repository/adapter、deep import 或状态镜像。Module TODO 不得重新定义领域模型。

## 2026-08-14 Task Journey / Observer 对齐

- Task Observer 正常 progression 保持 deterministic；Model 只参与少数单 Task ambiguity diagnosis。
- System Observer 通过八类 bounded system views + 手机 REASON 做全系统评估；采用 caller-side batch/carry-forward/drill-down/global synthesis，不在 Model Domain 建第二 Store/Scheduler。
- Owner facts / Policy / deterministic rules 高于 model confidence；模型只能产生 typed judgement/assessment，不直接产生 Effect 或 workflow transition。
- 真实有效 context/load 以手机 REASON M4 类验证为准，不能用理论 context window 替代。

详见 `MODEL-DOC-03-08` 与平台 `PLATFORM-DOC-01-04`。

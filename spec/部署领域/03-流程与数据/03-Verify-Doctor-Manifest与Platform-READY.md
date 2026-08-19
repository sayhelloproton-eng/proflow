---
docId: DEPLOYMENT-DOC-03-03
title: Module 状态事实与 Platform 聚合边界
docType: observation
authority: normative
lifecycle: active
domain: deployment-governance
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs: []
---

# Module 状态事实与 Platform 聚合边界

> 顶层 `verify` / `doctor` / `manifest` / `status` / Platform READY 产品模型已删除。

## 1. Module owns truth

每个 Module 自己负责其状态与验证逻辑。Platform 不复制领域 health/config/runtime 判断。

`platform modules` 只聚合最小统一事实：

```text
moduleRef
version
configStatus
missingConfig?
runtimeStatus
```

其中：

```text
configStatus = READY | INCOMPLETE | INVALID
runtimeStatus = RUNNING | STOPPED | FAILED | UNKNOWN
```

`missingConfig` 只在 `INCOMPLETE` 时出现。

## 2. 没有 Platform READY

`platform modules` 不计算整体 readiness，也不输出 `READY/DEGRADED/ACTION_REQUIRED/NOT_READY` 等 Platform 状态。

真正能否启动由 `platform start` 在当次调用中分发各 Module validate/preflight 得到 authoritative result。

## 3. 没有 Manifest 命令

Module identity/version/topology/knowledge 分别由真实 package、descriptor 与 `platform docs` 聚合；不再生成第二份 Platform manifest 作为用户事实源。

## 4. 没有 Doctor 命令

诊断与 actionable error 属于 owning Module。Module 可在 status/validate/lifecycle result 中返回错误码、message、actionable information；Platform 只保留并透传。

## 5. Carrier / Browser / Model 等领域

这些领域仍可拥有自己的真实 verification/diagnostic 能力，但不再被包装成顶层 Platform `verify/doctor`。相关知识通过 Module docs 暴露，启动前条件由 Module validate/preflight 判断。

## 6. 历史事实

历史记录可以由各领域继续保留，但不能冒充当前 runtime truth。Platform modules 必须以 Module 当前 observation 为准。

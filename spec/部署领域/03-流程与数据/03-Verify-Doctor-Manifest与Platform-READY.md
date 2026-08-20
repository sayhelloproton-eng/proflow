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

> 顶层 `modules/verify/doctor/manifest` 与 Platform READY 产品模型已删除；当前入口是 `platform status`。

## 1. Module owns truth

每个 Module 自己负责当前 management 状态。Platform 不复制领域 health/config/runtime 判断。

`platform status` 只聚合：

```text
moduleRef/version = discovery metadata
setupStatus = READY | ACTION_REQUIRED | FAILED
runtimeStatus = RUNNING | STOPPED | FAILED | NOT_APPLICABLE
```

`configStatus/missingConfig` 删除。

## 2. Start readiness

不存在独立 Platform READY 或 preflight/validate 状态。真正能否启动只由当次 `Module.status.setupStatus` 判断；需要启动的 Module 必须 READY。

## 3. Setup owns actionable guidance

人工/外部条件由 `Module.setup` 返回 `ACTION_REQUIRED`；`platform setup` 必须继续遍历其它 Module，并一次聚合全部 `ACTION_REQUIRED/FAILED`。每个 Module 的 `SETUP.md` 按最短 Step 闭环，状态推进 Step 均提供 package-owned executable/verify；再次 setup 时 Module 重新观察真实环境。

## 4. Docs owns knowledge

Module identity/version/topology 来自 package/descriptor；能力/API/Contract 来自 `Module.docs`；完整 setup workflow 来自 `SETUP.md`。不再生成第二份 Platform manifest。

## 5. Diagnostic / verification extras

Carrier、Browser、Model、Migration 等 Module 可以拥有自己的真实 verification/diagnostic extra capability，但不包装成顶层 Platform `verify/doctor`，也不成为 start 的第二 gate。

## 6. 历史事实

历史记录可以继续保留，但不能冒充当前 runtime truth。`platform status` 必须以 Module 当前 observation 为准。
## Setup 加速不变量

`platform setup` 每次都必须扫描全部 discovered Module：`READY` 跳过，非 READY 继续调用 owning `Module.setup`；遇到 `ACTION_REQUIRED` 或 `FAILED` 也不得提前停止，最后一次性聚合完整清单。具体配置知识与步骤只属于各 Module。每个需要推进 setup 状态的 Module 必须以最短路径闭环：能自动就自动，真正人工动作才返回 `ACTION_REQUIRED`；对应 `SETUP.md` Step 必须提供 package-owned executable/verify 与 Success Condition，目标是最少用户操作、最少往返、最快达到 `setupStatus=READY` 并可启动。

---
docId: PLATFORM-EXTERNAL-RESOURCE-MODULES
title: ProFlow External Resource Modules
docType: external-resource-map
authority: normative
lifecycle: active
domain: platform
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs: []
---

# ProFlow External Resource Modules

所有进入真实运行链的外部资源都必须进入 Deployment Module Graph；外部资源本身不一定是 npm package，但必须有对应 Module Adapter/Descriptor。

| Resource | Owner/Governance | 典型能力 | 不能假装拥有的 lifecycle |
|---|---|---|---|
| ChatGPT Web / Custom GPT Carrier | Deployment governance + Agent Carrier contract | Actions、File Bridge、Code Interpreter/Web Search requirements、Role setup/verification | Module 不能假装完全自动创建/编辑 GPT；Web-only 动作通过标准 `ACTION_REQUIRED` + package-owned prepare/verify 闭环 |
| Chrome Runtime | Deployment governance + Execution Browser use | Extension load/runtime/page access | 不虚构平台不能控制的浏览器生命周期 |
| Microsoft Dev Tunnel | Deployment External Resource Module | public ingress / bind / status / setup；可保留 package-owned probe/verification extra | 七标准能力只表达真实可观察/可控制行为，不把 verification extra 升级成 Platform lifecycle |
| Model Provider API | Deployment External Resource Module + Model Provider Adapter | `model.provider.api` | 远端 API 不伪造 start/stop |

具体治理规则见部署领域 `04-模块/external-resources/统一治理.md`。 所有 External Resource setup 都遵循同一目标：能自动就自动，真正人工才 `ACTION_REQUIRED`，每个推进 Step 有 package-owned executable/verify，尽快达到 `setupStatus=READY`。

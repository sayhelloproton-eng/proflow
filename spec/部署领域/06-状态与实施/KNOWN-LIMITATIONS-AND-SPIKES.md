---
docId: DEPLOYMENT-LIMITATIONS
title: 部署领域｜待确认项、限制与 Spike
docType: limitations
authority: normative
lifecycle: active
domain: deployment-governance
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs: []
---

# 部署领域｜待确认项、限制与 Spike

## 状态规则

```text
TODO = 正确目标和实施方法已经确定，但尚未完成
PENDING_SPIKE = 外部行为或关键假设尚未通过真实验证
KNOWN_LIMITATION = 已知限制，必须有当前 fallback / operator action
FUTURE = 不属于 v1 当前范围
```

任何 `PENDING_SPIKE` 都不得成为没有 fallback 的 correctness dependency。只有真实 E2E/实验通过，并确认不破坏 ownership / contract / recovery 后，才可提升为正式主路径。

## DPL-LIMIT-001｜Custom GPT 配置是 Web-only
- Type: `KNOWN_LIMITATION`
- Current fallback: owning Agent/Carrier `Module.setup` 返回 `ACTION_REQUIRED`，用户完成 Web 动作后 Module 重新观察真实 Role/Carrier 状态；必要的深度 verification 保持 package-owned extra capability，Platform 不提供 verify/doctor 第二真源。

## DPL-LIMIT-002｜Carrier Workspace 管理要求可能因环境而异
- Type: `KNOWN_LIMITATION`
- 包括 domain allowlist、Actions enablement、Privacy Policy、auth restore 等。
- Current fallback: External Resource Module 逐项检测，缺失时 `ACTION_REQUIRED`，不伪装 READY。

## DPL-LIMIT-003｜recommended model 非强约束
- Type: `KNOWN_LIMITATION`
- READY 依据 capability + behavior/E2E，而不是 exact model id。

## DPL-FUTURE-004｜容器/集群部署
- Type: `FUTURE`
- v1 只面向当前单机/单体部署；无真实需求不引入 Docker/Kubernetes 编排层。

## DPL-LIMIT-005｜Provider endpoint resolver owner 未裁决
- Type: `KNOWN_LIMITATION / ARCHITECTURE_STOP`
- 当前完整 Platform setup 无 owner 负责 bounded discovery generic OpenAI-compatible endpoint；`model-provider-api` 的显式 URL 入口只允许诊断/实验或接收 resolver 输出。
- Current fallback: `model-provider-api=ACTION_REQUIRED`、`model-runtime=BLOCKED`；不要求用户提供机器可发现 LAN IP/Base URL，不在 Platform CLI 或 Model Domain 增加产品特判。
- Resolution gate: 若需新增 Module、改变当前 23 模块冻结顺序或放宽边界，先 Contract/Design Change。

## DPL-LIMIT-006｜源码与已安装产品同版本内容漂移
- Type: `KNOWN_LIMITATION`
- 父工作区仍加载旧 Carrier/Provider/Tunnel 行为；源码测试 PASS 不等于用户入口已获得修正。
- Current fallback: 使用新 patch version 走正式 release/publish/install 并回读实际 package/dist SHA；禁止覆盖 `node_modules` 或复制 `dist`。未经授权不发布。

## DPL-LIMIT-007｜整平台真实链尚未闭环
- Type: `KNOWN_LIMITATION`
- 历史 Tunnel exact-marker HTTP 200 只证明穿透；当前最终 Chrome/curl HTTP 502、真实模型外部门未完成。
- Current fallback: `PLATFORM_END_TO_END = NOT PASS`、`PHASE3_FINAL_GO = NO`；正式交付后从七命令重放。

## 当前 Setup 基线

“逐个 Module 才能发现下一项配置”不再视为可接受限制。当前基线要求 `platform setup` 一次遍历全部 discovered Module，并一次性聚合所有非 READY 状态对应的可执行步骤或阻塞原因；`BLOCKED` 必须明确上游依赖，不能伪装成 `FAILED`。每个 owning Module 必须提供最短 `SETUP.md` Step、package-owned executable/verify 与 Success Condition；真正无法自动化的外部现实才允许保留为 limitation/spike。

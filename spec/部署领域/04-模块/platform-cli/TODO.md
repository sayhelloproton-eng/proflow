---
docId: DEPLOYMENT-GOVERNANCE-TODO-PLATFORM-CLI
title: '`platform-cli` TODO'
docType: todo
authority: operational
lifecycle: active
domain: deployment-governance
boundedContext: deployment-governance
moduleRef: platform-cli
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- DEPLOYMENT-PLATFORM-CLI-TECH-DESIGN
- DEPLOYMENT-DOC-02-01
---

# `platform-cli` TODO

> 当前唯一实施计划是 R1 Docs → R2 Module resources → R3 Platform 七命令 → R4 Tests/Golden Path；完成后 STOP。

## R1 — Docs

- [x] 所有 active/normative 文档切到七命令与 Module autonomy。

## R2 — Module resources

- [x] Contract 定义七标准能力与 `setupStatus/runtimeStatus/issues`。
- [x] Template/Skill/Conformance 对齐 DOCS/SETUP 与配置暴露边界。
- [x] 24/24 governed package descriptor/adapter/package/manifest/docs 对齐。

## R3 — CLI refactor

- [x] package-manager primitive 保留为 package graph owner。
- [x] install = package sync + Module.install。
- [x] uninstall = Module.uninstall + package remove。
- [x] status/setup/docs/start/stop = generic Module forwarding/aggregation。
- [x] 删除 `modules`、preflight lifecycle、private config loader、production binding middleman。
- [x] exactly seven routable Platform commands。

## R4 — Tests / acceptance

- [x] 删除旧 management 行为测试。
- [x] 建 status/setup/start-stop/install-uninstall/seven-command targeted tests。
- [x] Conformance 证明所有 governed Module 七能力 + DOCS/SETUP。
- [x] 跑 simulated human Golden Path。

## Final stop

```text
SIMULATED_HUMAN_E2E = PASS
READY_FOR_HUMAN_ACCEPTANCE = YES
PLATFORM_REAL_E2E = NOT PASS
```

前两项只记录 0.1.36 冻结时的代码/模拟门，不能推导当前已安装产品或真实外部链 PASS。2026-08-26 父工作区真实 status 为 `20 READY / 2 ACTION_REQUIRED / 1 BLOCKED / 1 FAILED`，并确认 installed package 与 main 存在同版本内容漂移。当前仍需可区分版本的正式交付、安装回读和七命令真实重放。

任何非 Gate blocker 记录 `OUT_OF_SCOPE_DOMAIN`；缺 shared fact 记录 `SHARED_FACT_CONTRACT_MISSING`；两者都禁止向业务源码无限扩散。缺少 Deployment-owned Provider endpoint resolver 时记录 `ARCHITECTURE_STOP`，不得让 Platform CLI 特判 Provider 或向用户索取机器可发现 URL。

## Setup 全量验收

- [x] `platform setup` 一次遍历全部 discovered Module，READY 跳过，非 READY 不导致提前停止。
- [x] 所有未 READY Module 的引导或明确阻塞原因一次性聚合返回。
- [x] 所有需要 setup 的 Module 具备最短 `SETUP.md` Step、package-owned executable/verify 与 Success Condition。
- [x] 用户只提供真实人工/外部输入；path/token/endpoint/shared fact 不回退成人工配置。
- [x] 最终目标以最少用户操作、最少往返达到 READY 并进入 `platform start`。

冻结证据：`../../08-测试用例与验证/DEPLOYMENT-CLI-0.1.36-FREEZE-EVIDENCE.json`。后续功能变更必须以新 patch 版本重新打开 Gate。

## 2026-08-26 Automation / delivery follow-up

- [ ] 裁决 Deployment-owned Provider endpoint resolver；如需新增 Module 或改变 24 模块顺序，先做正式架构变更。
- [ ] 以新 patch version 完成正式 release/publish/install；未经授权不执行 push/publish。
- [ ] 安装后回读 24 个包版本和关键 dist SHA，确认不再加载旧 Carrier/Provider/Tunnel 语义。
- [ ] 重跑完整七命令与 Chrome/HTTPS、真实模型、重复 setup、provider-off recovery。
- [ ] 只有 authoritative states 与真实外部 evidence 一致时才更新 `PLATFORM_REAL_E2E`。

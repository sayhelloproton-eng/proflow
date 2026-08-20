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

- [ ] 所有 active/normative 文档切到七命令与 Module autonomy。

## R2 — Module resources

- [ ] Contract 定义七标准能力与 `setupStatus/runtimeStatus`。
- [ ] Template/Skill/Conformance 对齐 DOCS/SETUP 与配置暴露边界。
- [ ] 24/24 governed package descriptor/adapter/package/manifest/docs 对齐。

## R3 — CLI refactor

- [ ] package-manager primitive 保留为 package graph owner。
- [ ] install = package sync + Module.install。
- [ ] uninstall = Module.uninstall + package remove。
- [ ] status/setup/docs/start/stop = generic Module forwarding/aggregation。
- [ ] 删除 `modules`、preflight lifecycle、private config loader、production binding middleman。
- [ ] exactly seven routable Platform commands。

## R4 — Tests / acceptance

- [ ] 删除旧 management 行为测试。
- [ ] 建 status/setup/start-stop/install-uninstall/seven-command targeted tests。
- [ ] Conformance 证明所有 governed Module 七能力 + DOCS/SETUP。
- [ ] 跑 simulated human Golden Path。

## Final stop

```text
SIMULATED_HUMAN_E2E = PASS
READY_FOR_HUMAN_ACCEPTANCE = YES
→ STOP
```

任何非 Gate blocker 记录 `OUT_OF_SCOPE_DOMAIN`；缺 shared fact 记录 `SHARED_FACT_CONTRACT_MISSING`；两者都禁止向业务源码无限扩散。

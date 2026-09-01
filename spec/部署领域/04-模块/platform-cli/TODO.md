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
- [x] 23/23 governed package descriptor/adapter/package/manifest/docs 对齐。

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

## Final stop（2026-09-01 已完成）

```text
SIMULATED_HUMAN_E2E = PASS
READY_FOR_HUMAN_ACCEPTANCE = YES
PLATFORM_REAL_E2E = PASS
DEPLOYMENT_SUCCESS = YES
DEPLOYMENT = FROZEN
```

0.1.36 仅是历史工程冻结证据；当前 Final Freeze 使用 `platform-cli@0.1.50` 与真实 npm/Fresh Product Workspace 证据。没有新的可复现 regression evidence 时，不得重新打开本 TODO 的历史 delivery follow-up。

## Setup 全量验收

- [x] `platform setup` 一次遍历全部 discovered Module，READY 跳过，非 READY 不导致提前停止。
- [x] 所有未 READY Module 的引导或明确阻塞原因一次性聚合返回。
- [x] 所有需要 setup 的 Module 具备最短 `SETUP.md` Step、package-owned executable/verify 与 Success Condition。
- [x] 用户只提供真实人工/外部输入；path/token/endpoint/shared fact 不回退成人工配置。
- [x] 最终目标以最少用户操作、最少往返达到 READY 并进入 `platform start`。

历史冻结证据：`../../08-测试用例与验证/DEPLOYMENT-CLI-0.1.36-FREEZE-EVIDENCE.json`；当前 Final Freeze：`../../08-测试用例与验证/DEPLOYMENT-FINAL-FREEZE-20260901.json`。

## 历史｜2026-08-26 Automation / delivery follow-up

- [x] 历史项已由最终 URL/FAST/THINK 边界与 Final Fresh 覆盖；如未来改变当前 23 模块顺序，仍需正式架构变更。
- [x] 已完成可区分 patch release/publish/install；git push 仍未授权且不是 Final Freeze 前提。
- [x] Final Fresh 已通过真实 Registry install 与 runtime reality 排除旧 Carrier/Provider/Tunnel 语义。
- [x] 最终用户 Journey 与 required recovery scope 已完成；历史 provider-off evidence 保留，不在 Final Fresh 重做。
- [x] authoritative states 与真实外部 evidence 已对齐，`PLATFORM_REAL_E2E=PASS`。

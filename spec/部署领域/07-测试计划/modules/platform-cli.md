---
docId: TP-MODULE-PLATFORM-CLI
title: platform-cli｜开发前 Module Test Plan
docType: test-plan
authority: normative
lifecycle: active
domain: deployment-governance
subdomain: null
subdomains: []
boundedContext: deployment-governance
moduleRef: platform-cli
provides: []
requires: []
contractRefs: []
testPlanPhase: PRE_IMPLEMENTATION
testPlanStatus: FINAL_FROZEN
sourceRefs:
- DEPLOYMENT-PLATFORM-CLI-TECH-DESIGN
- DEPLOYMENT-DOC-05-02
- DEPLOYMENT-DOC-05-03
- DEPLOYMENT-DOC-03-04
implementationWave: Wave 6
---

# platform-cli 测试计划

## Frozen surface

Exactly seven top-level commands:

```text
install
uninstall
status
setup
docs
start
stop
```

`modules` 与所有 removed Platform commands 必须不可 routable；Module-specific extra command 不进入 Platform。

## Targeted tests

### status / setup / docs

`status` == Module.status 聚合；`setup` == Module.setup 转发；`docs` == Module.docs 聚合。Platform 不推导 private config/health，也不读取 configSlots 后生成 setup 指导。

### install / uninstall

Install 先完成 Registry/package-manager sync，再 dependency-order 调用 Module.install。Uninstall 先 reverse-order Module.uninstall，再 package remove。Platform 不 materialize Module private config。

### start / stop

Start 先聚合 Module.status；任一适用 Module `setupStatus != READY` 时 0 次 start。全部 READY 后 dependency-order start，fail-fast；无 preflight/validate。Stop reverse-order，fail-fast。

### composition

Platform 不存在 `createProductionBinding(configByModuleRef)`、private config loader、Module-specific branch。Internal service process entrypoint 可以存在，但 ownership 在 Module.start/stop。

## Simulated human integration

```text
Fresh Workspace
→ install
→ status
→ docs
→ setup
→ simulate ACTION_REQUIRED completion
→ setup
→ status
→ start
→ status
→ stop
→ uninstall
```

Final assertion：没有隐藏 old-engine route，Platform 不需要理解任何具体 Module 的 Chrome/GPT/Tunnel/SQLite/port/config 业务。

## Setup 全量聚合新增证明

- 证明 `platform setup` 一次遍历全部 discovered Module，READY 跳过。
- 证明首个 `ACTION_REQUIRED` 或 `FAILED` 不终止后续 Module setup。
- 证明最终一次性聚合所有未 READY Module 的 action/error/data。
- 证明 Platform 不解释 package-owned Step、executable/verify 或 opaque input。

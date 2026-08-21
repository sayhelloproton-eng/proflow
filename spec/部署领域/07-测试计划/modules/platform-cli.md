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

所有 ProFlow-owned CLI 均不提供 `--json`；`runCli()` 直接返回强类型对象，终端入口只渲染人类输出。传入 `--json` 必须返回 INVALID_REQUEST 并退出 1。

## Targeted tests

### status / setup / docs

`status` == Module.status 聚合并翻译公共枚举；`setup` == Module.setup 结构化 Step 聚合；`docs` == Module.docs 正文聚合且不显示 SETUP。Platform 不推导 private config/health，也不读取 configSlots 后生成 setup 指导。

### install / uninstall

Install 先完成 Registry/package-manager sync，再 dependency-order 调用 Module.install，并持续发送 Workspace/Registry/package-manager/Module progress event。Uninstall 先 reverse-order Module.uninstall，再 package remove，只清理由本次 install 引入的 pnpm minimumReleaseAgeExclude，保留用户 policy 与 `.proflow`。

### start / stop

Start 必须扫描全部 Module.status；任一 Module `setupStatus != READY` 时列全 blocker 且 0 次 start。全部 READY 后 dependency-order 执行，RUNNING/NOT_APPLICABLE 跳过，失败后 fail-fast；重试从失败点继续。Stop reverse-order，STOPPED/NOT_APPLICABLE 跳过，失败后 fail-fast，重试跳过已停止模块。

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

人工输出断言：长命令在完成前产生进度；帮助、状态、setup、start/stop 摘要均中文化；不得输出整块 JSON。

## Setup 全量聚合新增证明

- 证明 `platform setup` 一次遍历全部 discovered Module，READY 跳过。
- 证明首个 `ACTION_REQUIRED` 或 `FAILED` 不终止后续 Module setup。
- 证明最终一次性聚合所有未 READY Module 的 action/error/data。
- 证明 Platform 不解释 package-owned Step、executable/verify 或 opaque input。

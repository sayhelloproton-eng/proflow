---
docId: DEPLOYMENT-DOC-04-00
title: 五包架构与 Module 治理模型
docType: module-map
authority: normative
lifecycle: active
domain: deployment-governance
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs: []
---

# 五包架构与 Module 治理模型

## 1. 五包职责

### `module-contract`
定义 Module identity/kind/version、轻量 package discovery metadata、provides/requires、标准七能力、统一 operation result 与 `setupStatus/runtimeStatus` 状态合同。

### `module-template`
生成符合冻结模型的标准 Module 工程形式：descriptor、adapter、七标准能力、`DOCS.md`、`SETUP.md`。不生成 `CONFIGURATION.md`，也不生成 Platform-owned preflight/verify/doctor 心智。

### `deployment-conformance`
机械验证 package metadata、descriptor/manifest equality、七标准 adapter commands、DOCS/SETUP 与治理边界；不验证业务正确性，不要求 `createProductionBinding` 或 Platform config bus。

### `platform-cli`
一级命令固定：

```text
install uninstall status setup docs start stop
```

职责只包含 Registry/Workspace discovery、ordering、forwarding、aggregation 与 package-manager transaction orchestration。

### `module-skill`
AI 开发辅助，只消费 Contract/Template/Conformance 与七命令产品真源；不得重新发明 Platform-owned validation/config bus/Plan/Apply/Verify/Doctor。

## 2. Module 分类

`ModuleKind` 可继续区分 library/service/cli/browser-extension/agent-package/external-resource 等工程 profile，但所有 governed Module 都提供相同七标准能力。

## 3. 三个层级

```text
Module = 统一治理身份
Module Package = npm 承载物
Runtime Unit = 真实具备运行生命周期的实现
```

Library 不伪造独立 process；其标准 `start/stop` 可以 no-op，`runtimeStatus=NOT_APPLICABLE`。

## 4. 三层事实来源

```text
npm Registry
= 可同步的 ProFlow package/version set

Workspace package.json + package resolution
= 当前真实 package installation state

Package-owned descriptor + adapter + DOCS/SETUP
= Module topology / management / knowledge truth
```

Platform 不维护第二份业务或配置真源。

## 5. provides / requires

用于 Module topology、Contract discovery 与 start/stop ordering；不替代 npm dependency graph，也不把 shared fact 变成 Platform config copy。

## 6. 治理链

```text
Create / Adopt
→ Template
→ Descriptor / Adapter / DOCS / SETUP
→ Conformance
→ Release
→ platform install
→ platform status
→ platform setup
→ platform start / stop
→ platform uninstall
```

新增合规 Module 不需要修改 Platform CLI module-specific 业务代码；Module-specific extra command 也不进入 Platform 代理面。

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
定义 Module identity/kind/version、轻量 package discovery metadata、provides/requires、configSlots、documentation、lifecycle result 与统一 status observation。不存在 `installClass/installRequires`。

### `module-template`
生成符合薄 Platform 模型的标准 Module 工程形式：descriptor、adapter、status/validate/start/stop（按 kind 适用）与配置文档入口。不生成 package-owned 单包 install 心智。

### `deployment-conformance`
验证 package metadata、descriptor、adapter、status shape 与 config-bearing Module documentation 等治理合同，不再验证 Core/install closure 或旧 Platform Plan/Apply 能力。

### `platform-cli`
一级命令只保留：

```text
modules docs install uninstall start stop
```

职责只包含 Registry/Workspace discovery、aggregation、dispatch、Runtime dependency ordering 与 package-manager transaction orchestration。

### `module-skill`
AI 开发辅助，只消费 Contract/Template/Conformance 与六命令产品真源；不得重新发明 Platform-owned business validation、Plan/Apply/Verify/Doctor。

## 2. Module 分类

`ModuleKind` 可继续区分 library/service/cli/browser-extension/agent-package/external-resource 等工程 profile，但不再有 Core/Optional install class。

## 3. 三个层级

```text
Module = 统一治理身份
Module Package = npm 承载物
Runtime Unit = 真实具备运行生命周期的 Module
```

Library 不伪造 start/stop；运行型 Module 自己拥有 lifecycle truth。

## 4. 三层事实来源

```text
npm Registry
= 可同步的完整 ProFlow package/version set

Workspace package.json + package resolution
= 当前真实 package installation state

Package-owned descriptor + adapter + docs
= Module topology/config/status/lifecycle/knowledge truth
```

Platform 不维护第二份业务真源。

## 5. provides / requires

只用于 Runtime topology、AI knowledge 与 start/stop ordering；不用于 npm install ordering。

## 6. 治理链

```text
Create / Adopt
→ Template
→ Descriptor / Adapter / Docs
→ Conformance
→ Release
→ platform install
→ platform modules / docs
→ platform start / stop
→ platform uninstall
```

新增合规 Module 不需要修改 Platform CLI module-specific 业务代码。

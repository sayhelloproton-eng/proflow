---
docId: DEPLOYMENT-MODULE-TEMPLATE-TECH-DESIGN
title: '`module-template` 详细技术方案'
docType: module-design
authority: normative
lifecycle: active
domain: deployment-governance
moduleRef: module-template
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- DEPLOYMENT-MODULE-TEMPLATE-TECH-DESIGN
---

# `module-template` 详细技术方案

## 1. 目标

Template 只负责把当前 Module Contract 机械落成工程骨架，不拥有领域逻辑，也不生成 Platform-specific workflow。

## 2. Materialize 输入

`MaterializeModuleInput` 不再包含 `installClass`。创建者只提供真实 owner facts：module/package identity、kind、domain/summary、provides/requires、configSlots 与适用 lifecycle facts。

CLI 删除 `--install-class` 及 `core|optional` 校验。

## 3. Generated package metadata

`package.json.proflow` 只保留：

```text
module: true
descriptor / manifest index
```

不得生成 `installClass/installRequires`。

## 4. Descriptor

`descriptorFor()` 必须与新 contract 对齐，不包含 install classification；保留 Runtime topology、config、documentation 与真实 lifecycle declaration。

## 5. Status observation

所有可被 `platform modules` 发现的生成 profile 应提供统一 status observation seam：

```text
configStatus = READY | INCOMPLETE | INVALID
missingConfig? only when INCOMPLETE
runtimeStatus = RUNNING | STOPPED | FAILED | UNKNOWN
```

Skeleton 可以 fail-closed，但不得让 Platform 替 Module 猜状态。

## 6. Lifecycle by kind

- library：不生成虚假 start/stop；
- service：生成 package-owned validate/status/start/stop seam，真实 production binding 由 owner 完成；
- browser-extension / external-resource：生成对应 status/validate seam，不假设可自动删除外部资源；
- agent-package：生成知识/config/status 入口，不制造 service process。

Template 不再要求 Platform-owned `createServiceProcessBinding`。

## 7. Documentation

所有 Module 至少生成 README / documentation index；configSlots 非空时必须生成 `CONFIGURATION.md`（或等价足量配置指导）。

配置指导必须说明字段含义、来源、格式、敏感性、materialization 方法与基础完成判定。

## 8. Package-owned install surface

不存在单 package Platform install 产品概念。Template 不再生成 `self-install.mjs` 或 service CLI 的 install delegation branch。

## 9. Conformance

生成结果必须直接通过当前 deployment-conformance 的 metadata/descriptor/status/docs 检查；不得依赖后续 Platform CLI 特判修补。

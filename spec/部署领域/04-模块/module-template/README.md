---
docId: DEPLOYMENT-GOVERNANCE-MODULE-MODULE-TEMPLATE
title: '`module-template` Module'
docType: module-index
authority: normative
lifecycle: active
domain: deployment-governance
boundedContext: deployment-governance
moduleRef: module-template
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- DEPLOYMENT-MODULE-TEMPLATE-TECH-DESIGN
---

# `module-template` Module

## Identity

```text
moduleRef: module-template
package: @tomflow/proflow-module-template
kind: library
```

## Purpose

统一生成符合当前 Module Contract 的 package 骨架，使新增 Module 无需修改 Platform CLI module-specific 逻辑。

生成目标包括：

- 最小 discovery metadata；
- `proflow.module.json` / runtime descriptor；
- 七标准 adapter capabilities；
- `DOCS.md` / `SETUP.md`；
- `SETUP.md` 最短闭环 Step 与 package-owned executable/verify seam；
- `provides/requires` 与真正 public config schema。

不生成 `CONFIGURATION.md`、`installClass/installRequires`、Platform preflight/verify/doctor 或 `createProductionBinding(configByModuleRef)`。

## Stable create entry

Template 继续提供 `materializeModule()` 与稳定 create CLI；这是 Module-specific extra capability，不属于 Platform 标准命令面。

## Boundary

Template 只生成治理形式，不猜领域 API/permission/业务状态。真实 service/browser/external-resource 行为与 setup 脚本内容由 package owner 实现；Template 只强制“能自动就自动、必须人工才问、每步可执行/可验证、最终映射 READY”的结构。无 runtime 的 profile 通过 `NOT_APPLICABLE` 表达。

## Technical docs

- [TECHNICAL-DESIGN.md](TECHNICAL-DESIGN.md)
- [00-五包架构与Module治理模型.md](../00-五包架构与Module治理模型.md)

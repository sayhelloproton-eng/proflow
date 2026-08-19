---
docId: DEPLOYMENT-DEPLOYMENT-CONFORMANCE-TECH-DESIGN
title: '`deployment-conformance` 详细技术方案'
docType: module-design
authority: normative
lifecycle: active
domain: deployment-governance
moduleRef: deployment-conformance
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- DEPLOYMENT-DEPLOYMENT-CONFORMANCE-TECH-DESIGN
---

# `deployment-conformance` 详细技术方案

## 1. Goal

确保任意 governed package 可以被六命令 Platform 机械发现、理解和分发，而无需 Platform 特判。

## 2. Package checks

```text
@tomflow/proflow-* identity
package.json.proflow.module === true
descriptor/manifest path valid
published files contain descriptor
```

删除 `package.json.proflow.installClass/installRequires` 及其一致性/closure 检查。

## 3. Descriptor checks

验证 identity/version/kind/platformCompatibility、provides/requires、configSlots、documentation 与真实 lifecycle declaration。Static descriptor 与 runtime descriptor 语义一致。

## 4. Status contract

需要参与 `platform modules` 的 Module adapter 必须能返回：

```text
configStatus: READY | INCOMPLETE | INVALID
missingConfig?: string[]
runtimeStatus: RUNNING | STOPPED | FAILED | UNKNOWN
```

`missingConfig` 仅 INCOMPLETE 时允许。

## 5. Documentation contract

configSlots 非空时，必须至少存在足够的配置指导，说明来源/格式/敏感性/materialization/完成判定。

## 6. Lifecycle contract

只声明真实拥有的 primitive。Service/运行型 Module 必须 package-owned；Platform-owned process wrapper 不是 conformance 目标。

## 7. Runtime topology

Repository graph gate 继续验证 `provides/requires` unresolved/incompatible/cycle；不再做 npm install closure 验证。

## 8. Boundary

Conformance 证明治理合同，不证明 Browser/Model/Gateway 等业务正确性；不得把真实外部账号变成 CI 依赖。

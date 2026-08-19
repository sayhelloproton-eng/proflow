---
docId: DEPLOYMENT-GOVERNANCE-TECH-MODULE-SKILL
title: '`module-skill` Technical Design Index'
docType: module-design-index
authority: normative
lifecycle: active
domain: deployment-governance
boundedContext: deployment-governance
moduleRef: module-skill
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- DEPLOYMENT-GOVERNANCE-TECH-MODULE-SKILL
---

# `module-skill` 详细技术方案

## 1. 角色

Skill 负责把已经冻结的 Module owner facts 落到标准 package 结构，并调用 Template/Conformance；不负责重新设计 Platform CLI。

## 2. 必须使用的当前合同

- package discovery metadata 不含 `installClass/installRequires`；
- `provides/requires` 只表示 Runtime topology；
- configSlots 与 documentation 由 Module owner 维护；
- status observation 由 Module 实现；
- validate/start/stop 只在真实适用时实现。

## 3. 禁止生成

```text
platform plan/apply/upgrade/verify/doctor/manifest
platform preflight CLI
package-local platform install <self>
Platform-owned business health/config checks
```

## 4. Config-bearing Module

Skill 必须确保配置文档说明值来源、格式、敏感性、materialization 和完成判定；不能只列字段名。

## 5. Maintenance

Owner 修改 descriptor/status/lifecycle 后，同步 static descriptor 与 docs，并重新运行 conformance。任何需要改变领域 Contract 的问题退出本 Skill 范围。

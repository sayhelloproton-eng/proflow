---
docId: DEPLOYMENT-PLATFORM-CLI-TECH-DESIGN
title: '`platform-cli` 详细技术方案'
docType: module-design
authority: normative
lifecycle: active
domain: deployment-governance
moduleRef: platform-cli
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- DEPLOYMENT-PLATFORM-CLI-TECH-DESIGN
- DEPLOYMENT-DOC-02-01
---

# `platform-cli` 详细技术方案

## 1. Surface

唯一一级命令：`modules/docs/install/uninstall/start/stop`。所有 removed command 必须不可 routable，也不可通过别名/隐藏 positional route 复活。

## 2. Install

```text
resolve workspace
→ validate Workspace-local metadata
→ discover complete ProFlow package/version set from private scope
→ one package-manager sync transaction where possible
→ re-observe actual installed versions
→ discover/validate Module descriptors
→ initialize/reuse minimal .proflow metadata
```

Install 幂等并承担版本同步；不执行 runtime config/readiness/human action，不生成 INSTALL.md，不走 Plan/Apply。

## 3. Uninstall

识别当前 Workspace `package.json` 中 ProFlow dependencies/devDependencies，一次 package-manager remove；不隐式 stop，不清理 `.proflow`。

## 4. Modules

调用各 installed Module 自己的 status/observe seam，校验并聚合：

```text
moduleRef
version
configStatus
missingConfig?
runtimeStatus
```

无整体 Platform readiness、manifest 或 verification state。

## 5. Docs

一次聚合所有 Module：

```text
moduleRef
provides
requires
configSlots
documents
```

无 positional module/document 参数。

## 6. Start

```text
Discover
→ build provides/requires order
→ dispatch all applicable validate/preflight in order (fail-fast)
→ only if all PASS: dispatch start in order (fail-fast)
```

Platform 不实现 Module 私有检查；start 中途失败不自动 rollback。

## 7. Stop

逆依赖顺序分发 Module stop，fail-fast；不做 validate/verify/repair。

## 8. Package manager primitive

从旧 Apply driver 提取 npm/pnpm/yarn selection、exact-version args、safe argv、manifest preparation、installed-version observation 与 cleanup helper，形成薄 batch `syncPackages/removePackages`。迁完 caller 后才删除旧 Apply engine。

## 9. Lifecycle binding

运行型 package 自己提供 production binding。Platform composition 直接消费 package-owned binding；不再创建通用 Platform service-process owner。

## 10. Workspace metadata

仅保留 canonical workspace 与最小 local identity/binding metadata。删除 global binding lifecycle state machine，但不得删除/覆盖用户 `.proflow` 数据。

## 11. Delete gate

每个旧 engine 文件删除前必须满足：CodeGraph caller count = 0 且 `rg` import/reference count = 0。

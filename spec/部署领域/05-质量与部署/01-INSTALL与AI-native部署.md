---
docId: DEPLOYMENT-DOC-05-01
title: INSTALL 与 AI-native Deployment
docType: operational-design
authority: normative
lifecycle: active
domain: deployment-governance
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs: []
---

# INSTALL 与 AI-native 部署

## 1. AI-native Golden Path

```text
platform install
→ platform status
→ platform docs（AI 理解 Module）
→ platform setup（按 Module 当前事实逐步引导）
→ platform status
→ platform start
→ platform status
→ platform stop
```

不存在 `platform modules`、INSTALL.md、Plan/Apply、独立 configure/preflight/verify/doctor/manifest 用户流程。

## 2. Install

Install 分两层，不能混为一谈：

```text
package install
→ Registry discovery + package-manager sync

Module install
→ discover/order → Module.install
```

`Module.install` 自己 materialize 所有可确定的 Module-owned state/config/artifact。Platform 不替 Module 创建私有配置，也不把 deterministic 值暴露给用户。

重复 `platform install` 必须可重入；无独立 `platform upgrade`。

## 3. Install success

只证明 package set 已同步且每个 `Module.install` 成功完成；不等于 setup READY，也不等于 runtime RUNNING。

## 4. Status / Docs / Setup

`status` 聚合 Module-owned `setupStatus/runtimeStatus`；`docs` 聚合 `Module.docs`；`setup` 转发 `Module.setup`。

AI 通过 `DOCS.md` 理解能力，通过 `SETUP.md + Module.setup` 知道完整路线与当前下一步。Platform 不再读取 configSlots 后自行解释“缺什么配置”。

## 5. Config ownership

Module 能唯一确定的配置由 `Module.install` 自闭环；跨 Module 值走 Producer-owned Contract/shared fact；只有真实用户选择或外部现实才进入 `Module.setup`。

## 6. Start

`platform start` 只使用 `Module.status` 作为 readiness gate：需要启动的 Module 必须 `setupStatus=READY`，然后按 Runtime dependency order 调用 `Module.start`。没有独立 preflight/validate。

## 7. Uninstall

`platform uninstall` 先按逆依赖顺序调用 `Module.uninstall`，再移除 Workspace package dependencies。Module 决定自己的 owned artifact 保留/清理规则；Platform 不自动删除整个 `.proflow`。

## 8. Workspace identity

不依赖 global current Workspace。Workspace identity 只作为 Platform-local metadata，不成为 Module lifecycle/config truth。

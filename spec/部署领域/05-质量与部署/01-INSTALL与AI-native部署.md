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
→ platform modules
→ platform docs（如需理解/配置）
→ AI/人按 Module docs 完成配置或外部动作
→ platform modules 再观察
→ platform start
```

不存在生成 `INSTALL.md`、Plan/Apply、独立 configure/verify/doctor/manifest 用户流程。

## 2. Install

Install 是 Platform Instance 级完整 package set 同步：

```text
--workspace 或 cwd
→ 校验已有 Workspace-local metadata
→ Registry 动态发现完整 ProFlow package/version set
→ package manager 一次 transaction 同步
→ 重新读取真实安装结果
→ descriptor validation
→ Fresh 时初始化最小 .proflow metadata
```

删除 Core package、`installRequires`、单包 install closure。重复 install 同时承担 update/no-op，因此无 `platform upgrade`。

## 3. Install success

只证明：目标 package set 已同步、真实 packages 可读取、descriptors 合法、Workspace metadata 无冲突且 Fresh 初始化成功。

不证明 runtime READY。

## 4. Modules / Docs

`modules` 聚合 Module-owned `configStatus/missingConfig?/runtimeStatus`；`docs` 聚合 provides/requires/configSlots/documents。AI 根据这两者理解当前现实与配置方法。

## 5. Config

Platform 不新增 `configure`。一般配置由文档明确载体；特殊物理 materialization 必须由 owning Module 显式能力完成。

## 6. Start

真正启动前条件由每个 Module 自己 validate/preflight；Platform 只分发且 fail-fast。全部验证通过后才按 Runtime dependency order start。

## 7. Uninstall

只删除 Workspace 中 ProFlow dependencies/devDependencies；不自动 stop，不删除 `.proflow`，不清理用户配置/历史/外部资源。

## 8. Workspace identity

不依赖 global current Workspace。Binding 是 Workspace-local metadata，可跨 uninstall/reinstall 保留。

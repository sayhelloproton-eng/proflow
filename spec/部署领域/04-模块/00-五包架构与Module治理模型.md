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

规则真源。定义 Module identity/kind/version、npm package discovery metadata、install class、Provides/Requires、Requirements、Config Slots、Lifecycle、Verification、Effects/cleanup、AI-readable documentation entry、结构化 Result/Error、compatibility。

### `module-template`

标准工程起点和持续治理基线。按 Module Kind Profile 生成最小正确结构，并记录 `templateVersion`。新 Module 必须天然包含被 Registry Discovery、Workspace Discovery、Platform CLI 与 AI 文档聚合识别所需的标准形式；领域具体职责和 API 内容仍由 Module Owner 填写。

### `deployment-conformance`

强制门。用于本地检查、CI、发布/升级前 gate，验证 Module 的 package metadata、Descriptor、Adapter、文档入口与真实能力是否一致，确保 Module 能被平台稳定安装和管理。

### `platform-cli`

唯一平台级确定性部署应用。它不维护固定 Platform Install Catalog，也不复制各 Module 的业务知识。

Platform CLI 负责两类不同发现：

1. **Registry Discovery**：限定查询 ProFlow npm scope 下的正式 package，读取 package metadata，形成“当前可安装 Module Set”；
2. **Workspace Discovery**：读取目标 Workspace 的 `package.json` 与本地可解析 package，形成“当前已安装/已管理 Module Set”。

随后 CLI 生成 dependency graph 与 plan，真实执行 package install/upgrade/uninstall，调用 package-owned lifecycle，汇总 status/verify/doctor/manifest/docs。

### `module-skill`

AI 开发辅助。使用 Contract/Template/Conformance 与稳定 CLI 创建、维护 Module，不能自创新规范，也不能复制一套独立的 Module 知识。

## 2. Module 分类

```ts
type ModuleKind =
  | "library"
  | "service"
  | "cli"
  | "browser-extension"
  | "agent-package"
  | "external-resource";

type ModuleInstallClass = "core" | "optional";
```

Kind 只决定默认工程 profile 和可接受 lifecycle shape，不决定业务领域。

Install Class 只决定默认安装策略：

- `core`：标准平台最小组成，`platform install` 默认纳入；当前阶段禁止单包 uninstall；
- `optional`：只在用户/AI 显式选择时安装；安装后与 core 一样进入统一管理。

不为当前阶段设计 core provider replacement / capability substitution。

## 3. 三个不同层级

```text
Module
= 统一治理身份

Module Package
= 承载实现/Adapter/Contract/Docs 的 npm package

Deployment Unit
= 具备真实部署/运行生命周期的 Module
```

例：`execution-contracts` 是 Module + npm package，但不是 Deployment Unit；Browser Extension 是 Module + Deployment Unit；远端模型 API 是 External Resource Module，其 Adapter 是 npm package。

并非所有 Module 都提供服务。Platform CLI 只能调用 Descriptor 声明且 Adapter 真实实现的 lifecycle primitive；不支持的 start/stop 必须明确跳过或报告 unsupported，禁止伪造成功。

## 4. 三层事实来源

```text
npm Registry
= 当前有哪些 ProFlow Module 可以安装

Workspace package.json + 本地 package resolution
= 当前 Workspace 实际安装、Platform CLI 必须统一管理哪些 Module

Package-owned Module Descriptor + Docs
= 每个 Module 属于哪个领域、负责什么、提供/依赖什么、支持哪些 lifecycle、产生哪些 effects、如何验证与诊断
```

Platform CLI 只负责发现、聚合、规划与执行，不成为各 Module 领域知识的第二真源。

## 5. 治理链

```text
Create / Adopt
→ Template
→ Descriptor / Package Metadata / Docs
→ Conformance
→ Package Release to npm Registry
→ Registry Discovery / Explicit Install
→ Workspace package.json / lockfile / node_modules
→ Workspace Discovery
→ Platform Plan
→ Apply
→ Status / Verify / Doctor / Docs
→ Upgrade / Uninstall
→ Re-Conformance
```

无论 package 通过 Platform CLI 还是 package 自身 `npx` 入口安装，只要最终真实进入目标 Workspace 的 `package.json` 并可从本地解析，就进入同一 Platform Managed Module Set。

整个生命周期都使用同一套 Contract。

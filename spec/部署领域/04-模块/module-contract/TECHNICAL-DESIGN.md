---
docId: DEPLOYMENT-MODULE-CONTRACT-TECH-DESIGN
title: '`module-contract` 详细技术方案'
docType: module-design
authority: normative
lifecycle: active
domain: deployment-governance
moduleRef: module-contract
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- DEPLOYMENT-MODULE-CONTRACT-TECH-DESIGN
---

# `module-contract` 详细技术方案

## 1. 目标

用最小类型描述“Platform 如何发现并统一调用一个自治 Module”，不承载部署执行或业务逻辑。

## 2. Package discovery metadata

`package.json.proflow` 只保留识别与 descriptor/manifest 索引：

```ts
interface ProFlowPackageMetadata {
  module: true;
  descriptor: string;
  manifest?: string;
}
```
## 3. Descriptor minimum facts

```ts
interface ModuleDescriptor {
  contract: "module";
  contractVersion: string;
  moduleRef: string;
  packageName: string;
  moduleVersion: string;
  kind: ModuleKind;
  templateVersion: string;
  platformCompatibility: string;
  identity: ModuleIdentity;
  provides: ModuleProvide[];
  requires: ModuleRequire[];
  requirements: ModuleRequirement[];
  configSlots: ConfigSlot[];
  documentation: ModuleDocumentationEntry[];
}
```

七标准能力不是 optional lifecycle declaration，而是 governed Module 的固定管理合同。`verification/effects` 如保留，只能作为 Module-specific metadata，不能重新成为 Platform 标准流程。

## 4. Standard commands

```text
install / uninstall / status / setup / docs / start / stop
```

Adapter 必须提供七个同名能力。额外 command 可以存在，但不进入 Platform 标准代理面。
## 5. Runtime topology and shared facts

```ts
interface ModuleProvide { contractRef: string; version: string }
interface ModuleRequire { contractRef: string; versionRange: string; optional?: boolean }
```

`provides/requires` 用于 topology、Contract discovery 与 ordering。真正跨 Module 数据必须通过 Producer-owned public Contract/shared fact，Platform 不复制值。

## 6. Public config schema

`ConfigSlot` 只描述真正需要用户/外部世界提供的 setup 值。以下内容不得进入 public config：Workspace 派生路径、固定 loopback、token path、Module-owned artifact path、可由其他 Module 提供的 shared fact。

## 7. Status observation

```ts
type ModuleSetupStatus = "READY" | "ACTION_REQUIRED" | "FAILED";
type ModuleRuntimeStatus = "RUNNING" | "STOPPED" | "FAILED" | "NOT_APPLICABLE";

interface ModuleStatusObservation {
  setupStatus: ModuleSetupStatus;
  runtimeStatus: ModuleRuntimeStatus;
}
```

状态由 Module 自己判断，Platform 只校验 shape 并聚合。禁止 `configStatus/missingConfig`、Platform-derived readiness 或 `UNKNOWN` 逃避观察。

## 8. Operation result

结构化 result 允许 `SUCCEEDED/BLOCKED/ACTION_REQUIRED/FAILED`。`ACTION_REQUIRED` 只用于真实人工或外部参与；Module 本应自闭环却失败时必须返回 `FAILED`。

`ACTION_REQUIRED` 必须是**可执行引导**而不是状态标签：owner 应在现有 `actionRequired.action/description`（以及必要时 owner-defined `data`）中给出当前 Step、最小人工输入和 package-owned executable/verify。Platform 只透传/聚合，不解析这些 Module-specific 内容。
## 9. Documentation

标准知识文件固定为 `DOCS.md` 与 `SETUP.md`。`docs` 返回 Module-owned knowledge；`setup` 根据真实状态给出当前动作。Schema/descriptor 不是第三份指导文档。

`SETUP.md` 的最小闭环结构为：`Step ID/Goal → Executable → Human Action(可选) → Verify → Success Condition`。Executable/Verify 必须属于 package owner；允许同一个命令同时完成 prepare/apply/verify，优先减少步骤和用户往返。

## 10. Static descriptor

正式 package 继续发布 `proflow.module.json`，并与 runtime descriptor 保持语义一致；用途是 static discovery/conformance，不是 Platform manifest 命令。

## 11. Security

Package metadata、descriptor、adapter result、外部输入均先按 `unknown` 处理并通过 runtime schema。Raw secret 不进入 status/docs 公共输出。

## 12. Delete gate

以下概念不得再作为标准管理合同出现：

```text
platform modules
preflight / validate
platform verify / doctor
configStatus / missingConfig
createProductionBinding requirement
CONFIGURATION.md requirement
```

## Setup 全量与闭环合同

Module Contract 要支持薄 Platform 的全量 setup：`platform setup` 一次遍历全部 discovered Module，READY 跳过，所有非 READY Module 都有机会执行自己的 `setup`，`ACTION_REQUIRED/FAILED` 由 Platform 最终一次性聚合。Module 自己负责最短闭环：先自动完成 machine-owned 步骤，只把真正人工/外部动作暴露为 `ACTION_REQUIRED`；`SETUP.md` 的每个状态推进 Step 都必须对应 package-owned executable/verify 与 Success Condition。

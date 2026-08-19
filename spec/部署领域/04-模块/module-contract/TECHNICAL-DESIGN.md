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

用最小类型描述“Platform 如何发现、理解、聚合和分发一个 Module”，不承载部署执行或业务逻辑。

## 2. Package Discovery Metadata

`package.json` 优先使用 npm 标准字段。ProFlow namespaced metadata 只保留识别和 descriptor 索引：

```ts
interface ProFlowPackageMetadata {
  module: true;
  descriptor: string;
  manifest?: string;
}
```

不存在 `installClass` / `installRequires`。

## 3. Descriptor 最小事实

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
  lifecycle: LifecycleSupport;
  documentation: ModuleDocumentationEntry[];
}
```

既有 verification/effects schema 可以为 package-local compatibility 保留，但六命令 Platform 不把它们升级成独立用户工作流。

## 4. Runtime topology

```ts
interface ModuleProvide { contractRef: string; version: string }
interface ModuleRequire { contractRef: string; versionRange: string; optional?: boolean }
```

只用于 Runtime topology、docs 和 start/stop ordering；npm dependency 由 package manager 负责。

## 5. Config

```ts
interface ConfigSlot {
  key: string;
  type: ConfigValueType;
  required: boolean;
  default?: unknown;
  sensitive?: boolean;
  description: string;
}
```

`platform docs` 对外归一为：`key/type/required/default/sensitive/description`，无 default 时输出 `null`，非敏感时输出 `false`。

## 6. Status Observation

新增统一 schema：

```ts
type ModuleConfigStatus = "READY" | "INCOMPLETE" | "INVALID";
type ModuleRuntimeStatus = "RUNNING" | "STOPPED" | "FAILED" | "UNKNOWN";

interface ModuleStatusObservation {
  configStatus: ModuleConfigStatus;
  missingConfig?: string[];
  runtimeStatus: ModuleRuntimeStatus;
}
```

约束：`missingConfig` 只允许在 `configStatus === "INCOMPLETE"` 时存在。值由 Module 自己判断，Platform 只校验 shape 并聚合。

## 7. Lifecycle

Lifecycle enum 可以保留更广 package-local primitive 以兼容既有 Module，但六命令 Platform 主路径只消费：

```text
status / observe
preflight / validate
start
stop
```

Platform 不拥有 Module health/process/config truth。

## 8. Operation Result

继续使用结构化 Module result，允许 `SUCCEEDED/BLOCKED/ACTION_REQUIRED/FAILED`，并保留 Module 原始 error/actionable information。Platform 不再创建 `PLAN_STALE/APPLY_FAILED/VERIFY_FAILED/DOCTOR_FAILED/UPGRADE_FAILED` 等用户工作流状态。

## 9. Static descriptor

正式 package 继续发布 `proflow.module.json`，并与 runtime descriptor 保持语义一致；用途是静态 discovery/conformance，不是 Platform manifest 命令。

## 10. Identity invariant

正式 package 的 `moduleRef` 与 `@tomflow/proflow-` 后缀保持一一对应。Aliases 不是当前目标。

## 11. Security

CLI/package metadata/descriptor/外部输入均先按 `unknown` 处理并通过 runtime schema。Raw secret 不进入 status/docs 公共输出。

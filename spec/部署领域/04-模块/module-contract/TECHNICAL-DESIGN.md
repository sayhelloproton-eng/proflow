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

用最少类型描述“平台如何发现、理解并治理一个 Module”。不承载部署执行逻辑，也不实现 npm Registry 查询本身；Registry Discovery 由 Platform CLI 执行并消费本合同。

合同必须同时支撑：

- npm Registry 中的 ProFlow package 识别与安装分类；
- Workspace 已安装 Module 识别；
- Platform lifecycle / verify / doctor / uninstall cleanup；
- AI 对当前 Module 的领域职责、commands、APIs、Provides/Requires 与 docs 的机器可读发现。

## 2. Package Discovery Metadata

`package.json` 继续优先使用 npm 标准字段：`name/version/description/engines/dependencies/peerDependencies/optionalDependencies/bin/files/publishConfig` 等。

只有 npm 标准字段无法表达的 ProFlow 治理语义放入最小 namespaced metadata：

```ts
export type ModuleInstallClass = "core" | "optional";

export interface ProFlowPackageMetadata {
  module: true;
  installClass: ModuleInstallClass;
  descriptor: string;
}
```

约束：

- package 名必须符合 `@tomflow/proflow-*`；
- `module: true` 才能作为正式 ProFlow Module 被 Registry/Workspace Discovery 接管；
- `core` 是标准平台默认安装集，当前阶段禁止单包 uninstall；
- `optional` 只在显式选择时安装，安装后进入与 core 相同的统一管理；
- deprecated 不维护第二份 ProFlow 状态字段，优先尊重 npm Registry deprecation metadata；
- `descriptor` 指向随 package 发布的机器可读 Module Descriptor 入口。

## 3. 核心类型

```ts
export type ModuleKind =
  | "library"
  | "service"
  | "cli"
  | "browser-extension"
  | "agent-package"
  | "external-resource";

export interface ModuleIdentity {
  domain: string;
  summary: string;
}

export interface ModuleDocumentationEntry {
  id: string;
  path: string;
  description?: string;
}

export interface ModuleDescriptor {
  contract: "module";
  contractVersion: "1.0.0";
  moduleRef: string;
  packageName: string;
  moduleVersion: string;
  kind: ModuleKind;
  templateVersion: string;
  platformCompatibility: string;
  installClass: ModuleInstallClass;
  identity: ModuleIdentity;
  provides: ModuleProvide[];
  requires: ModuleRequire[];
  requirements: ModuleRequirement[];
  configSlots: ConfigSlot[];
  lifecycle: LifecycleSupport;
  verification: VerificationContract;
  effects: DeploymentEffect[];
  documentation: ModuleDocumentationEntry[];
}
```

`packageName` 对 External Resource Module 指 Module Adapter npm package。

`installClass` 在 package metadata 和 Descriptor 中必须一致；前者用于 Registry/Workspace 快速发现，后者用于治理真实性与 Conformance。

## 4. Provides / Requires

```ts
export interface ModuleProvide {
  contractRef: string;
  version: string;
}

export interface ModuleRequire {
  contractRef: string;
  versionRange: string;
  optional?: boolean;
}
```

Platform CLI 负责版本范围兼容检查，不引入服务发现协议。

npm `dependencies` 表达真实 package installation dependency；Module `Provides/Requires` 表达平台逻辑 contract dependency。两者不可混用或互相替代。

## 5. Requirement

v1 采用 discriminated union，类别只保留当前需要：

```ts
type ModuleRequirement =
  | RuntimeRequirement
  | ExecutableRequirement
  | FileSystemRequirement
  | PortRequirement
  | NetworkRequirement
  | ModuleContractRequirement
  | HumanRequirement;
```

Requirement 查询必须零副作用。

## 6. Config Slot

```ts
type ConfigValueType =
  | "string"
  | "number"
  | "boolean"
  | "url"
  | "path"
  | "enum"
  | "moduleRef"
  | "secretRef";

interface ConfigSlot {
  key: string;
  type: ConfigValueType;
  required: boolean;
  description: string;
  default?: unknown;
  enumValues?: string[];
  sensitive?: boolean;
}
```

`default` 只能用于安全、确定性默认值。Secret 只声明 `secretRef`。

`moduleRef` 用于引用受 Deployment 管理的 Module，而不是让领域长期保存裸 URL。例如 `fastProviderModuleRef / reasonProviderModuleRef / chromeRuntimeModuleRef / carrierModuleRef / publicIngressModuleRef`。Provides/Requires 仍只表达逻辑 capability，不携带物理 URL/port/process。

## 7. Lifecycle

```ts
type LifecyclePrimitive =
  | "describe"
  | "preflight"
  | "status"
  | "verify"
  | "doctor"
  | "start"
  | "stop"
  | "restart"
  | "migrate"
  | "uninstall";

interface LifecycleSupport {
  supported: LifecyclePrimitive[];
}
```

禁止因为统一接口而伪造 N/A 生命周期。

- `library` 不得声明 `start/stop/restart`；
- service 是否支持 process lifecycle 由 Descriptor + Adapter 共同证明；
- `uninstall` 表示 Module 有 package-owned cleanup/uninstall lifecycle；package manager remove 仍由 Platform CLI 负责；
- core Module 当前不允许单包 uninstall，因此即使 Adapter 能 cleanup，Platform CLI 也必须先执行 core guard。

## 8. Effects 与卸载清理

```ts
export type EffectRetention =
  | "remove"
  | "preserve"
  | "explicit-purge";

export interface DeploymentEffect {
  kind: "filesystem" | "process" | "network" | "external-resource";
  description: string;
  path?: string;
  retention: EffectRetention;
}
```

规则：

- `remove`：uninstall 可自动清理的临时/runtime/cache/generated 等 package-owned effect；
- `preserve`：默认保留，例如业务数据库、用户资产或需要人工保留的状态；
- `explicit-purge`：只有显式 destructive purge 才允许删除；普通 uninstall 不得盲删。

Descriptor 只声明 effect ownership/cleanup policy；真实 cleanup 由 package-owned Adapter/lifecycle 实现，Platform CLI 负责排序、调用与结果汇总。

## 9. Documentation / AI-readable self-description

每个 Module 自己拥有其领域与能力说明，Platform CLI 只聚合：

```ts
export interface ModuleDocumentationEntry {
  id: string;
  path: string;
  description?: string;
}
```

Descriptor 不复制 npm package surface。AI-readable 聚合时，`package.json.bin` 是真实 CLI executable 真源，`package.json.exports` 是真实 package Public API entry 真源；Descriptor 继续拥有 Domain/职责、逻辑 Provides/Requires、Lifecycle、配置、Effects、Verification 与文档索引。这样 package 发布表面与领域/部署语义各自只有一个 Owner。

Descriptor 至少通过 identity/provides/requires/lifecycle/documentation 让 AI 查询：

- Module 属于哪个 Domain、负责什么；
- 提供哪些逻辑 contract / capability；
- 依赖哪些逻辑 contract；
- 支持哪些 lifecycle；
- 可进一步读取哪些 package-owned docs。

详细 OpenAPI/schema/README/运行文档仍由 package 自己发布，Descriptor 只保存稳定索引，不复制完整文档正文。

## 10. Structured Result

```ts
type ModuleOperationStatus =
  | "SUCCEEDED"
  | "BLOCKED"
  | "ACTION_REQUIRED"
  | "FAILED";

interface ModuleOperationResult<T> {
  contract: "deployment.result.v1";
  ok: boolean;
  status: ModuleOperationStatus;
  moduleRef: string;
  moduleVersion: string;
  data?: T;
  checks?: DeploymentCheck[];
  actionRequired?: HumanAction;
  error?: DeploymentError;
}
```

检查项：

```text
PASS | FAIL | WARN | SKIP
```

## 11. 最小错误语义

```text
INVALID_REQUEST
MODULE_NOT_FOUND
CONTRACT_INVALID
CONFORMANCE_FAILED
COMPATIBILITY_MISMATCH
DEPENDENCY_UNRESOLVED
REQUIREMENT_UNMET
CONFIG_REQUIRED
LIFECYCLE_UNSUPPORTED
CORE_PACKAGE_REQUIRED
EXTERNAL_RESOURCE_UNAVAILABLE
PLAN_INVALID
PLAN_STALE
APPLY_FAILED
VERIFY_FAILED
DOCTOR_FAILED
UPGRADE_FAILED
UNINSTALL_FAILED
COMMAND_FAILED
```

`ACTION_REQUIRED` 是操作状态，不当作技术错误。

## 12. Version

内部 Module：`moduleVersion == package.json version`。

External Module：

- `moduleVersion` = Adapter Package version；
- `resourceVersion?` = 动态 status/verify 中观察到的外部资源版本；
- 无版本资源不伪造，使用 resource identity + config fingerprint + verification record。

## 13. Runtime Validation

所有来自 CLI、package metadata、descriptor file、第三方 process、外部 API 的数据先视为 `unknown`，通过 runtime schema 后进入强类型对象。

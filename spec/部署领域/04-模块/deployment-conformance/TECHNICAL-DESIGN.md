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

确保任意 governed package 都能被七命令 Platform 机械发现和统一调用，无需 Platform 特判，同时不把业务正确性塞进部署门禁。

## 2. Package checks

```text
@tomflow/proflow-* identity
package.json.proflow.module === true
descriptor/manifest path valid
published files contain descriptor + manifest + DOCS.md + SETUP.md
```

不验证 `installClass/installRequires/Core/Optional`。
## 3. Descriptor / manifest checks

验证 identity/version/kind/platformCompatibility、provides/requires、requirements、真正 public config schema 与 documentation index。Static `proflow.module.json` 必须与 runtime descriptor 语义一致。

七标准能力不再通过 optional lifecycle list 表达；它们由 governed Module Contract 固定要求。

## 4. Adapter contract

每个 governed Module adapter 必须同时提供：

```text
install
uninstall
status
setup
docs
start
stop
```

Conformance 只验证存在性、结构化结果和基础语义，不替 Module 判断真实业务状态。Module-specific extra command 允许存在，Platform 不需要认识。

## 5. Status contract

```text
setupStatus: READY | ACTION_REQUIRED | FAILED
runtimeStatus: RUNNING | STOPPED | FAILED | NOT_APPLICABLE
```

禁止标准 status 再暴露 `configStatus/missingConfig`；禁止用 `UNKNOWN` 代替 Module 自己的观察责任。
## 6. Documentation contract

标准知识文件必须且只按统一入口提供：

```text
DOCS.md
SETUP.md
```

`CONFIGURATION.md` 不再是标准文档要求。Config schema 可以作为 machine contract 存在，但不形成第三份指导文档。

Conformance 对 `SETUP.md` 至少机械验证：

```text
存在明确 Step
每个推进 Step 有 package-owned Executable
人工 Step 有 prepare/verify executable
存在 Success Condition，并最终指向 setupStatus=READY
不得把 deterministic path/token/loopback/shared fact 写成用户必填项
```

Conformance 不要求固定命令名称，也不理解步骤业务语义；owner 可以用一个命令合并多个自动步骤。目标是验证“可执行闭环”，不是强迫形式化拆步。

## 7. Removed requirements

Conformance 不再要求：

```text
preflight / validate
platform verify / doctor
createProductionBinding
service public start CLI
CONFIGURATION.md
configStatus / missingConfig
Platform private config materialization
```

真实 module-specific verification、migration、architecture、role/custom-gpt 等 extra capability 可继续存在，只要不伪装成 Platform 标准面。

## 8. Boundary

Conformance 只证明治理合同，不证明 Browser/Model/Gateway/Task/Agent 业务正确性，也不得把真实外部账号变成 CI 依赖。若为了通过 Conformance 必须修改领域业务逻辑，判定为越界并 STOP。
## Setup Closure Conformance

Conformance 必须机械证明 setup 结构可被薄 Platform 全量聚合：每个需要 setup 的 Module 有最短 `SETUP.md` Step；每个状态推进 Step 声明 package-owned executable/verify 与 Success Condition；`ACTION_REQUIRED` 只用于真实人工/外部动作。`platform setup` 可一次遍历全部 discovered Module，READY 跳过，所有非 READY 继续执行并一次性聚合，而不需要 Platform 理解 Module 私有配置或步骤。

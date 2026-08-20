---
docId: DEPLOYMENT-GOVERNANCE-BC-README
title: '`deployment-governance` Bounded Context'
docType: bounded-context
authority: normative
lifecycle: active
domain: deployment-governance
boundedContext: deployment-governance
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs: []
---
# `deployment-governance` Bounded Context

## Identity

| Field | Value |
|---|---|
| Parent Domain | `deployment-governance` |
| Context Ref | `deployment-governance` |
| Subdomain | v1 未进一步拆分正式 Subdomain |
| Language Scope | ModuleDescriptor、ModuleProvide/Require、ModuleRequirement、ModuleOperationResult、ModuleStatus、ACTION_REQUIRED、DOCS/SETUP、七标准管理能力。 |

v1 未进一步冻结独立 Subdomain；五个 npm package 是工程职责分工，不是五个业务 Subdomain/BC。

## Purpose

统一 Module Contract、七标准管理能力、Module topology、package lifecycle、External Resource setup 与版本治理；其中 setup 以“全量聚合 + Module 自闭环 + 最少人工操作 + 最快 READY/start”为固定产品目标。

## Model Boundary

该 Context 是当前领域正式模型和 Ubiquitous Language 的适用边界。内部 Module 可以有独立工程职责，但不得自行建立第二套领域事实、状态机或跨域 Ownership。

## Owns / Does Not Own

权威边界见 [领域宪章](../../01-领域宪章与Bounded-Context-Map.md)。

## Upstream

各 Domain Module 声明 identity/provides/requires 与七标准管理能力；Module 自己拥有 status/setup/docs、私有配置与真实 runtime composition。`Module.setup` 必须先自动完成所有可自动步骤，并通过 package-owned executable/verify 把真正的人工动作闭环到 `setupStatus=READY`。External Resource Adapter 只翻译外部现实，不把配置 ownership 交给 Platform。

只允许通过对应 Public Contract / logical Requires 获取上游事实；禁止读取其他领域 DB、Repository 或内部 Adapter。

## Downstream

platform-cli、conformance、template、module-skill 以及各 Module 标准管理调用方消费 Deployment governance facts；Module-specific extra capability 由对应 package 自己发布和消费。

下游只能通过本 Context/Domain Public Contract 使用能力，不得 deep import 内部 Module。

## Ubiquitous Language / Model

见 [领域模型/当前设计规则](../../03-当前设计原则与不变量.md)。

## Public Surface

见 [Public Contract](../../../02-契约/01-跨领域Deployment-Matrix与Composition-Root边界.md)。本 README 不复制 DTO、状态或 error 的第二份 normative 定义。

## Key Flows / Persistence / Recovery

当前七命令与 setup 主流程以 [当前设计规则](../../03-当前设计原则与不变量.md) 为最高真源；`03-流程与数据/` 下的流程/恢复文档必须与该真源一致，不得复活 Plan/Apply/Preflight 等已移除 Platform 产品面。

## Modules

见 [Module Registry](../../../04-模块/README.md)。

## Testing / Acceptance / TODO

见 [质量与验收](../../../05-质量与部署/02-测试门禁与真实验收.md) 与各 Module `TODO.md`。

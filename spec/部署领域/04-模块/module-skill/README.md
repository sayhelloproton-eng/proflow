---
docId: DEPLOYMENT-GOVERNANCE-MODULE-MODULE-SKILL
title: '`module-skill` Module'
docType: module-index
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

# `module-skill` Module

## Purpose

`module-skill` 是 AI 创建/维护 ProFlow Module 的治理技能，只消费当前 Contract、Template、Conformance 与七命令真源，不复制 Platform 或领域业务知识。

## Frozen ownership

```text
Module = install/setup/status/docs/start/stop/uninstall truth
Platform = discovery / ordering / forwarding / aggregation
Package manager = npm dependency mutation
```

## Setup/config rule

```text
Module 能唯一确定 → install
跨 Module 事实 → Producer-owned Contract/shared fact
用户选择或外部现实 → setup
```

标准知识文档只保留 `DOCS.md` 与 `SETUP.md`。`SETUP.md` 必须是最短闭环步骤；每个推进步骤有 package-owned executable/verify。缺少 owner fact 时 fail-closed；不得让 Platform CLI 补业务逻辑或充当 config bus。

## Boundary

不得 invent capability/dependency/permission/owner/domain；Module-specific extra command 可以存在，但必须由 owner 自己定义和维护。
## Creation / maintenance flow

```text
read owner facts
→ use module-template
→ fill descriptor / adapter / DOCS / SETUP
→ run deployment-conformance
→ release package
```

Skill 必须按三类配置事实处理：

- Module 可唯一确定 → `install` 自闭环；
- Producer Module 提供 → shared fact / public Contract；
- 用户选择或外部现实 → `setup`。

对每个非 READY Module，Skill 必须继续追到：**自动步骤是否已经自动、真正人工输入是什么、对应 executable 是什么、完成后由哪个 executable verify、最终如何让 `Module.status.setupStatus=READY`**。任何一项答不上来都不是“文档问题”，而是 setup seam 未闭环，必须在 owning package 范围内补齐。

## Standard knowledge

每个 governed Module 标准知识文件只保留：`DOCS.md` 与 `SETUP.md`。Skill 不再生成或要求 `CONFIGURATION.md`。

## Extra capability

Module-specific extra command 可以存在；Skill 只要求它属于 Module 自身业务或稳定 Contract。Platform 不代理、不解释。

## Boundary

不得 invent capability/dependency/permission/owner/domain。缺 shared fact contract 时返回 `SHARED_FACT_CONTRACT_MISSING`；若适配七能力必须修改领域业务 API/状态机/service 算法，返回 `OUT_OF_SCOPE_DOMAIN`，禁止把问题塞进 Platform。

## Setup 加速合同

`platform setup` 每次都必须一次遍历全部 discovered Module；`READY` 跳过，`ACTION_REQUIRED/FAILED` 继续扫描并最终全量聚合。Platform 只转发/聚合，不解释步骤。各 Module 的 `SETUP.md` 必须以最短闭环 Step 描述；每个状态推进 Step 有 package-owned executable/verify 与 Success Condition。自动化优先，只有真实人工或外部动作才能要求用户输入，目标是最少操作、最少往返、最快 READY → start。

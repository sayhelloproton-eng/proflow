---
docId: DEPLOYMENT-MODULE-TEMPLATE-TECH-DESIGN
title: '`module-template` 详细技术方案'
docType: module-design
authority: normative
lifecycle: active
domain: deployment-governance
moduleRef: module-template
subdomain: null
subdomains: []
provides: []
requires: []
contractRefs:
- DEPLOYMENT-MODULE-TEMPLATE-TECH-DESIGN
---

# `module-template` 详细技术方案

## 1. 目标

Template 只负责把当前 Module Contract 机械落成工程骨架，不拥有领域逻辑，也不生成 Platform-specific workflow。

## 2. Materialize 输入

创建者只提供真实 owner facts：module/package identity、kind、domain/summary、provides/requires、真正 public config schema 与 Module-specific extra capability metadata。

不得输入 `installClass/installRequires`，不得要求调用者描述七标准能力是否存在：七能力由 Contract 强制。

## 3. Generated package metadata

`package.json.proflow` 只保留 `module: true` 与 descriptor/manifest 索引。
## 4. Generated adapter

所有 profile 都生成相同七标准能力：

```text
install
uninstall
status
setup
docs
start
stop
```

- library：`start/stop` 为标准 no-op，`runtimeStatus=NOT_APPLICABLE`；
- service：七能力委托 owner runtime/process 实现；
- browser-extension / external-resource：install/setup/status 分离 deterministic materialization 与真实外部动作；
- agent-package：setup 承担 Custom GPT/Role 等真实人工步骤；
- cli：标准管理面与 module-specific CLI 分离。

Template 不生成 `preflight/validate/verify/doctor/restart` 作为标准管理能力，也不要求 `createProductionBinding`。

## 5. Config ownership

```text
Module 可唯一确定 → install
Producer Module 提供 → shared fact / public Contract
用户或外部世界决定 → setup
```

Template 不允许把 Workspace 路径、固定 loopback、token path、artifact path 或 shared fact 生成为 user-required config。
## 6. Standard knowledge

每个生成 Module 必须包含：

```text
DOCS.md
SETUP.md
```

`CONFIGURATION.md` 不再生成。`DOCS.md` 讲能力/API/Contract；`SETUP.md` 讲 install 之后真实的人机/外部步骤。没有人工 setup 的 Module 也生成最小 `SETUP.md`，明确 `install` 已完成全部 deterministic preparation。

生成的 `SETUP.md` 必须采用**最短闭环 Step**，每个会推进 setup 的 Step 至少包含：

```text
Step ID / Goal
Executable（package-owned command/script）
Human Action（仅真正不可自动时存在）
Verify（package-owned executable；可与 Executable 合并）
Success Condition（最终映射到 Module.status.setupStatus）
```

Template 不强制“一步一个进程”或人为拆分流程；如果一个 package-owned command 能自动完成准备、写入、验证，就应一次完成。纯人工 Web/UI 步骤也必须有 prepare/verify executable，使 AI 不依赖口头确认。

## 7. CLI

生成的 Module 不因 kind 自动获得标准 shell CLI。标准七能力由 `deployment/adapter.ts` 提供统一管理真源。

真实 module-specific CLI 可以由 owner 显式声明并保留；Template 自身的 `create` CLI 也是其额外业务能力。

## 8. Conformance

生成结果必须直接通过当前 deployment-conformance：metadata、descriptor/manifest、七 adapter commands、status shape、DOCS/SETUP。不得依赖 Platform CLI 特判修补。

## 9. 禁止回退

Template 不得重新生成：`CONFIGURATION.md`、`configStatus/missingConfig`、optional lifecycle list、Platform preflight、`createProductionBinding` requirement 或 package-local Platform install wrapper。
